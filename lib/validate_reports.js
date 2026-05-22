import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { styleText } from 'node:util';

import auth from './auth.js';
import Request from './request.js';
import {
  getReportSeverity,
  getSummary
} from './security-release/security-release.js';

const H1_TRIAGED_REPORTS_URL =
  'https://api.hackerone.com/v1/reports?filter[program][]=nodejs&filter[state][]=triaged';
const CACHE_FOLDER = '.ncu-cache/security-report-validation';
const MANUAL_REVIEW_VALIDITY = 'needs-manual-review';

const CVSS_WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
  UI: { N: 0.85, R: 0.62 },
  S: { U: 'U', C: 'C' },
  CIA: { H: 0.56, L: 0.22, N: 0 }
};

const RATING_BY_SCORE = [
  [9.0, 'critical'],
  [7.0, 'high'],
  [4.0, 'medium'],
  [0.1, 'low'],
  [0, 'none']
];

const style = {
  bold: (text) => styleText('bold', text),
  cyan: (text) => styleText('cyan', text),
  dim: (text) => styleText('dim', text),
  green: (text) => styleText('green', text),
  red: (text) => styleText('red', text),
  yellow: (text) => styleText('yellow', text)
};

const LLM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    validity: {
      enum: ['valid', 'invalid', 'needs-more-info']
    },
    severity_correct: {
      type: 'boolean'
    },
    suggested_severity: {
      enum: ['none', 'low', 'medium', 'high', 'critical', 'informational']
    },
    suggested_cvss: {
      type: 'string'
    },
    cwe: {
      type: 'string'
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 100
    },
    reasoning: {
      type: 'string'
    },
    threat_model_references: {
      type: 'array',
      items: {
        type: 'string'
      }
    }
  },
  required: [
    'validity',
    'severity_correct',
    'suggested_severity',
    'suggested_cvss',
    'cwe',
    'confidence',
    'reasoning',
    'threat_model_references'
  ]
};

// These reporter-controlled keyword matches are low-weight topic hints only.
// They help the heuristic report and LLM prompt focus on relevant threat-model
// areas, but they must not decide validity or severity by themselves.
const IN_SCOPE_TOPIC_HINTS = [
  {
    id: 'http-request-smuggling',
    keywords: [
      'request smuggling',
      'cwe-444',
      'content-length',
      'transfer-encoding',
      'http parser',
      'llhttp'
    ],
    reason: 'HTTP parser inconsistencies that can cause request smuggling are in scope.'
  },
  {
    id: 'tls-certificate-validation',
    keywords: [
      'certificate validation',
      'hostname verification',
      'checkserveridentity',
      'unauthorized',
      'authorized: true',
      'tls'
    ],
    reason: 'Improper TLS certificate validation is explicitly in scope.'
  },
  {
    id: 'permission-model-bypass',
    keywords: [
      'permission model',
      '--permission',
      'allow-fs-read',
      'allow-fs-write',
      'allow-child-process',
      'allow-worker'
    ],
    reason: 'Permission model bypasses are generally security relevant.'
  },
  {
    id: 'crypto-confidentiality',
    keywords: [
      'crypto',
      'decryption',
      'private key',
      'cipher',
      'signature verification',
      'timing attack'
    ],
    reason: 'Crypto bugs that break expected confidentiality or integrity are in scope.'
  },
  {
    id: 'remote-dos',
    keywords: [
      'denial of service',
      'dos',
      'crash',
      'assertion',
      'oom',
      'out of memory',
      'remote'
    ],
    reason: 'Remote DoS may be in scope if it satisfies the SECURITY.md DoS criteria.'
  }
];

// These hints are also low-weight context only. A match should prompt closer
// review against SECURITY.md, not an automatic out-of-scope decision.
const OUT_OF_SCOPE_TOPIC_HINTS = [
  {
    id: 'trusted-application-code',
    keywords: [
      'malicious application',
      'application code',
      'userland code',
      'prototype pollution',
      'json.parse',
      'path.join',
      'path.normalize'
    ],
    reason: 'Node.js trusts code it is asked to run and inputs provided by application code.'
  },
  {
    id: 'third-party-module',
    keywords: [
      'npm package',
      'third-party module',
      'express',
      'fastify',
      'koa',
      'webpack',
      'vite'
    ],
    reason: 'Security bugs in third-party modules are outside Node.js core scope.'
  },
  {
    id: 'inspector-debugger',
    keywords: [
      'inspector',
      'debugger',
      'devtools'
    ],
    reason: 'Inspector connections are trusted under the Node.js threat model.'
  },
  {
    id: 'experimental-platform',
    keywords: [
      'experimental platform',
      'wsl',
      'unsupported platform'
    ],
    reason: 'Issues limited to experimental or unsupported platforms are not valid security issues.'
  },
  {
    id: 'manual-tls-session-reuse',
    keywords: [
      'manual session',
      'caller passes the session',
      'session option',
      'reuse a tls session',
      'different servername'
    ],
    reason: 'Caller-supplied TLS sessions are application inputs and must be ' +
      'reused for the same identity.'
  }
];

function roundUp1(value) {
  return Math.ceil(value * 10) / 10;
}

function parseCvssVector(vector) {
  if (!isCvssVector(vector)) return null;
  const parts = vector.split('/');
  const metrics = {};
  for (const part of parts) {
    if (part.startsWith('CVSS:')) continue;
    const [key, value] = part.split(':');
    metrics[key] = value;
  }
  return metrics;
}

function isCvssVector(vector) {
  return typeof vector === 'string' && /^CVSS:\d+\.\d+\//.test(vector);
}

function hasSuggestedCvss(vector) {
  return isCvssVector(vector);
}

function diffCvssVectors(current, suggested) {
  const currentMetrics = parseCvssVector(current);
  const suggestedMetrics = parseCvssVector(suggested);

  if (!currentMetrics || !suggestedMetrics) {
    return [];
  }

  const keys = new Set([
    ...Object.keys(currentMetrics),
    ...Object.keys(suggestedMetrics)
  ]);

  return [...keys]
    .filter((key) => currentMetrics[key] !== suggestedMetrics[key])
    .map((key) => ({
      metric: key,
      current: currentMetrics[key] ?? '',
      suggested: suggestedMetrics[key] ?? ''
    }));
}

function formatCvssDiff(current, suggested) {
  const diff = diffCvssVectors(current, suggested);
  if (!current && !suggested) return 'current and suggested CVSS are unset';
  if (!isCvssVector(current)) return 'current CVSS is unset or invalid';
  if (!hasSuggestedCvss(suggested)) return 'no suggested CVSS vector';
  if (!diff.length) return 'no metric changes';
  return diff
    .map(({ metric, current, suggested }) => `${metric}:${current}->${suggested}`)
    .join(', ');
}

function formatCvssDiffBlock(current, suggested) {
  const diff = diffCvssVectors(current, suggested);
  if (!current && !suggested) {
    return style.dim('  current and suggested CVSS are unset');
  }
  if (!isCvssVector(current)) {
    return style.red('- Current: unset') + '\n' +
      style.green(`+ Suggested: ${suggested}`);
  }
  if (!hasSuggestedCvss(suggested)) {
    return style.dim('  no suggested CVSS vector');
  }
  if (!diff.length) return style.dim('  no metric changes');

  return diff.map(({ metric, current, suggested }) => [
    style.red(`- ${metric}:${current}`),
    style.green(`+ ${metric}:${suggested}`)
  ].join('\n')).join('\n');
}

function cvssMatches(current, suggested) {
  return Boolean(isCvssVector(current) && isCvssVector(suggested) && current === suggested);
}

function scoreCvss31(vector) {
  const metrics = parseCvssVector(vector);
  if (!metrics) return null;

  const required = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];
  if (!required.every((metric) => metrics[metric])) return null;

  const scopeChanged = metrics.S === 'C';
  const impactSubScore = 1 -
    ((1 - CVSS_WEIGHTS.CIA[metrics.C]) *
     (1 - CVSS_WEIGHTS.CIA[metrics.I]) *
     (1 - CVSS_WEIGHTS.CIA[metrics.A]));
  const impact = scopeChanged
    ? 7.52 * (impactSubScore - 0.029) - 3.25 * ((impactSubScore - 0.02) ** 15)
    : 6.42 * impactSubScore;
  const privilegesRequired = scopeChanged
    ? CVSS_WEIGHTS.PR_C[metrics.PR]
    : CVSS_WEIGHTS.PR_U[metrics.PR];
  const exploitability = 8.22 *
    CVSS_WEIGHTS.AV[metrics.AV] *
    CVSS_WEIGHTS.AC[metrics.AC] *
    privilegesRequired *
    CVSS_WEIGHTS.UI[metrics.UI];

  if (impact <= 0) return 0;
  if (scopeChanged) {
    return roundUp1(Math.min(1.08 * (impact + exploitability), 10));
  }
  return roundUp1(Math.min(impact + exploitability, 10));
}

function ratingFromScore(score) {
  if (score === null) return '';
  return RATING_BY_SCORE.find(([minimum]) => score >= minimum)[1];
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

function signalMatches(text, signal) {
  return signal.keywords.filter((keyword) => text.includes(keyword));
}

function matchTopicHints(text, hints) {
  return hints
    .map((hint) => ({ ...hint, matched: signalMatches(text, hint) }))
    .filter((hint) => hint.matched.length > 0);
}

function topicHintSummaries(hints) {
  return hints.map(({ id, reason, matched }) => ({
    id,
    reason,
    matched
  }));
}

function addTopicHintFinding(findings, label, hints) {
  if (!hints.length) return;
  findings.push(
    `Matched ${label} topic hints: ${hints.map((hint) => hint.id).join(', ')}.`
  );
}

function getReportText(report) {
  const attributes = report.attributes ?? {};
  const summary = report.relationships?.summaries?.data
    ?.map((summary) => summary?.attributes?.content)
    .filter(Boolean)
    .join('\n');

  return [
    attributes.title,
    attributes.vulnerability_information,
    attributes.impact,
    attributes.summary,
    attributes.description,
    summary
  ].filter(Boolean).join('\n');
}

function getComparableReports(report, allReports) {
  const weakness = getWeakness(report);
  if (!weakness.id) return [];

  return allReports
    .filter((candidate) => candidate.id !== report.id)
    .filter((candidate) => getWeakness(candidate).id === weakness.id)
    .map((candidate) => {
      const severity = getReportSeverity(candidate);
      return {
        id: candidate.id,
        title: candidate.attributes?.title ?? '',
        url: `https://hackerone.com/reports/${candidate.id}`,
        state: candidate.attributes?.state ?? '',
        severity: {
          current: severity.rating,
          cvssVector: severity.cvss_vector_string
        },
        team_summary: getSummary(candidate) ?? ''
      };
    });
}

function getReportPromptPayload(report, heuristic, allReports) {
  const attributes = report.attributes ?? {};
  const reporter = report.relationships?.reporter?.data?.attributes?.username;
  const comments = report.relationships?.activities?.data
    ?.map((activity) => activity?.attributes?.message)
    .filter(Boolean)
    .join('\n\n');

  return {
    id: report.id,
    title: attributes.title ?? '',
    url: `https://hackerone.com/reports/${report.id}`,
    state: attributes.state ?? '',
    severity: heuristic.severity,
    weakness: heuristic.weakness,
    reporter,
    vulnerability_information: attributes.vulnerability_information ?? '',
    impact: attributes.impact ?? '',
    summary: attributes.summary ?? '',
    description: attributes.description ?? '',
    comments: comments ?? '',
    comparable_reports_same_weakness: getComparableReports(report, allReports)
  };
}

function getWeakness(report) {
  const weakness = report.relationships?.weakness?.data;
  return {
    id: weakness?.id ?? '',
    name: weakness?.attributes?.name ?? ''
  };
}

function assessReport(report) {
  const text = normalizeText(getReportText(report));
  const severity = getReportSeverity(report);
  const weakness = getWeakness(report);
  const cvssScore = scoreCvss31(severity.cvss_vector_string);
  const cvssRating = ratingFromScore(cvssScore);
  const currentRating = normalizeText(severity.rating);

  const inScopeHints = matchTopicHints(text, IN_SCOPE_TOPIC_HINTS);
  const outOfScopeHints = matchTopicHints(text, OUT_OF_SCOPE_TOPIC_HINTS);

  const findings = [];
  if (!severity.rating) findings.push('Missing HackerOne severity rating.');
  if (!severity.cvss_vector_string) findings.push('Missing CVSS vector.');
  if (cvssRating && currentRating && cvssRating !== currentRating) {
    findings.push(
      `HackerOne rating "${currentRating}" does not match ` +
      `CVSS vector rating "${cvssRating}".`
    );
  }
  addTopicHintFinding(findings, 'in-scope', inScopeHints);
  addTopicHintFinding(findings, 'out-of-scope', outOfScopeHints);

  return {
    id: report.id,
    title: report.attributes?.title ?? '',
    url: `https://hackerone.com/reports/${report.id}`,
    state: report.attributes?.state ?? '',
    severity: {
      current: severity.rating,
      cvssVector: severity.cvss_vector_string,
      cvssScore,
      cvssRating,
      suggested: ''
    },
    weakness,
    validity: MANUAL_REVIEW_VALIDITY,
    signals: {
      inScope: topicHintSummaries(inScopeHints),
      outOfScope: topicHintSummaries(outOfScopeHints)
    },
    findings
  };
}

function reportToMarkdown(result) {
  const findings = result.findings.length
    ? result.findings.map((finding) => `  - ${finding}`).join('\n')
    : '  - No obvious mismatch detected by heuristic checks.';
  const inScopeSignals = result.signals.inScope
    .map((signal) => `  - ${signal.id}: ${signal.reason}`)
    .join('\n') || '  - None';
  const outOfScopeSignals = result.signals.outOfScope
    .map((signal) => `  - ${signal.id}: ${signal.reason}`)
    .join('\n') || '  - None';
  const matchingCvss = cvssMatches(
    result.severity.cvssVector,
    result.llm?.assessment?.suggested_cvss
  );
  const llm = result.llm?.assessment
    ? [
        `  - Provider: ${result.llm.provider}`,
        result.llm.model ? `  - Model: ${result.llm.model}` : '',
        result.llm.cached ? '  - Cache: hit' : '',
        `  - Validity: ${result.llm.assessment.validity}`,
        `  - Severity correct: ${result.llm.assessment.severity_correct}`,
        `  - Current CVSS: ${result.severity.cvssVector || 'unset'}`,
        `  - Suggested severity: ${result.llm.assessment.suggested_severity}`,
        `  - Suggested CVSS: ${
          matchingCvss ? 'matches current CVSS' : result.llm.assessment.suggested_cvss
        }`,
        `  - CVSS diff: ${
          formatCvssDiff(
            result.severity.cvssVector,
            result.llm.assessment.suggested_cvss
          )}`,
        `  - CWE: ${result.llm.assessment.cwe}`,
        `  - Confidence: ${result.llm.assessment.confidence}`,
        `  - Reasoning: ${result.llm.assessment.reasoning}`,
        `  - References: ${
          result.llm.assessment.threat_model_references.join(', ')}`
      ].join('\n')
    : result.llm?.error
      ? [
          `  - Provider: ${result.llm.provider}`,
          `  - Error: ${result.llm.error}`
        ].join('\n')
      : result.llm?.skipped
        ? `  - Provider: ${result.llm.provider}\n  - Skipped by user`
        : '  - Not requested';

  return [
    `### ${result.id}: ${result.title}`,
    '',
    `- URL: ${result.url}`,
    `- Validity: ${result.validity}`,
    `- Current severity: ${result.severity.current || 'unset'}`,
    `- CVSS: ${result.severity.cvssVector || 'unset'}`,
    `- CVSS score/rating: ${result.severity.cvssScore ?? 'n/a'} / ` +
      `${result.severity.cvssRating || 'n/a'}`,
    `- Suggested severity: ${result.severity.suggested || 'manual review'}`,
    `- Weakness: ${result.weakness.id || 'unset'} ${result.weakness.name || ''}`.trim(),
    '',
    'Findings:',
    findings,
    '',
    'In-scope topic hints:',
    inScopeSignals,
    '',
    'Out-of-scope topic hints:',
    outOfScopeSignals,
    '',
    'LLM assessment:',
    llm
  ].join('\n');
}

function llmAssessmentToMarkdown(result) {
  if (result.llm?.assessment) {
    const { assessment } = result.llm;
    const matchingCvss = cvssMatches(
      result.severity.cvssVector,
      assessment.suggested_cvss
    );
    const suggestedCvss = hasSuggestedCvss(assessment.suggested_cvss)
      ? assessment.suggested_cvss
      : 'not suggested';
    const validityColor = assessment.validity === 'valid'
      ? style.green
      : assessment.validity === 'invalid'
        ? style.red
        : style.yellow;
    const severityColor = assessment.severity_correct ? style.green : style.yellow;
    const confidence = typeof assessment.confidence === 'number'
      ? `${assessment.confidence}/100`
      : assessment.confidence;
    const severityLines = matchingCvss
      ? [
          `  Current rating    ${result.severity.current || 'unset'}`,
          `  Suggested rating  ${assessment.suggested_severity}`,
          `  CVSS              ${style.green('matches suggested CVSS')}`
        ]
      : [
          `  Current rating    ${result.severity.current || 'unset'}`,
          `  Suggested rating  ${assessment.suggested_severity}`,
          `  Current CVSS      ${result.severity.cvssVector || 'unset'}`,
          `  Suggested CVSS    ${suggestedCvss}`,
          '',
          hasSuggestedCvss(assessment.suggested_cvss)
            ? style.bold('CVSS Metric Diff')
            : style.bold('CVSS'),
          formatCvssDiffBlock(result.severity.cvssVector, assessment.suggested_cvss)
        ];

    return [
      `${style.bold('Report')} ${style.cyan(result.url)}`,
      `${style.bold('Title')}  ${result.title}`,
      `${style.bold('Model')}  ${result.llm.provider}`,
      result.llm.model ? `${style.bold('LLM')}    ${result.llm.model}` : '',
      result.llm.cached ? `${style.bold('Cache')}  hit` : '',
      '',
      style.bold('Decision'),
      `  Validity          ${validityColor(assessment.validity)}`,
      `  Severity correct  ${severityColor(String(assessment.severity_correct))}`,
      `  Confidence        ${style.cyan(confidence)}`,
      `  CWE               ${style.cyan(assessment.cwe)}`,
      '',
      style.bold('Severity'),
      ...severityLines,
      '',
      style.bold('References'),
      ...assessment.threat_model_references.map((reference) => `  - ${reference}`),
      '',
      style.bold('Reasoning'),
      assessment.reasoning
    ].join('\n');
  }

  if (result.llm?.error) {
    return [
      `Report: ${result.url}`,
      `Title: ${result.title}`,
      `Provider: ${result.llm.provider}`,
      `Error: ${result.llm.error}`
    ].join('\n');
  }

  return 'No LLM assessment available.';
}

function toMarkdown(results) {
  const counts = results.reduce((summary, result) => {
    summary[result.validity] = (summary[result.validity] ?? 0) + 1;
    if (result.findings.length) summary.withFindings++;
    return summary;
  }, { withFindings: 0 });

  return [
    '# HackerOne Triaged Report Validation',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Reports: ${results.length}`,
    `Reports with findings: ${counts.withFindings}`,
    '',
    ...Object.entries(counts)
      .filter(([key]) => key !== 'withFindings')
      .map(([key, value]) => `- ${key}: ${value}`),
    '',
    'This is a heuristic triage assistant. Final validity and severity ' +
      'require human review against SECURITY.md.',
    '',
    ...results.map(reportToMarkdown)
  ].join('\n') + '\n';
}

async function fetchAllTriagedReports(req, limit) {
  let url = H1_TRIAGED_REPORTS_URL;
  const reports = [];

  while (url) {
    const response = await req.json(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${req.credentials.h1}`,
        'User-Agent': 'node-core-utils',
        Accept: 'application/json'
      }
    });
    if (response?.errors) {
      throw new Error(
        `Request to fetch triaged reports failed with: ${JSON.stringify(response.errors)}`
      );
    }

    reports.push(...(response.data ?? []));
    if (limit && reports.length >= limit) {
      return reports.slice(0, limit);
    }

    url = response.links?.next ?? null;
  }

  return reports;
}

function writeSchemaFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncu-report-schema-'));
  const schemaPath = path.join(dir, 'schema.json');
  fs.writeFileSync(schemaPath, JSON.stringify(LLM_OUTPUT_SCHEMA, null, 2));
  return {
    schemaPath,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function readFileIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readSimpleTomlString(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return match?.[1] ?? '';
}

function readJsonFileIfExists(file) {
  const source = readFileIfExists(file);
  if (!source) return {};
  try {
    return JSON.parse(source);
  } catch {
    return {};
  }
}

function inferCodexModel() {
  const config = readFileIfExists(path.join(os.homedir(), '.codex', 'config.toml'));
  const model = readSimpleTomlString(config, 'model');
  const effort = readSimpleTomlString(config, 'model_reasoning_effort');
  if (!model) return {};
  return { model: effort ? `${model} ${effort}` : model };
}

function inferClaudeModel() {
  const settings = readJsonFileIfExists(
    path.join(os.homedir(), '.claude', 'settings.json')
  );
  const model = settings.model ?? settings.defaultModel ?? process.env.CLAUDE_MODEL;
  return model ? { model } : {};
}

function inferCopilotModel() {
  return process.env.COPILOT_MODEL ? { model: process.env.COPILOT_MODEL } : {};
}

function inferLLMModel(provider, explicitModel) {
  if (explicitModel) {
    return {
      model: explicitModel,
      comment: ''
    };
  }

  let inferred;

  switch (provider) {
    case 'codex':
      inferred = inferCodexModel();
      break;
    case 'claude':
      inferred = inferClaudeModel();
      break;
    case 'copilot':
      inferred = inferCopilotModel();
      break;
    default:
      inferred = {};
  }

  if (inferred.model) {
    return {
      model: inferred.model,
      comment: ''
    };
  }

  return {
    model: 'default',
    comment:
      `Could not infer the ${provider} model from local CLI configuration; ` +
      'using "default" as the cache identity. Pass --llm-model to make this explicit.'
  };
}

function buildProviderCommand(provider, nodeRepo, commandOverride, model) {
  if (commandOverride) {
    return {
      command: commandOverride,
      args: [],
      cwd: nodeRepo,
      identity: commandOverride,
      shell: true
    };
  }

  switch (provider) {
    case 'codex': {
      const { schemaPath, cleanup } = writeSchemaFile();
      const args = ['exec'];
      if (model) {
        args.push('--model', model);
      }
      args.push(
        '-C',
        nodeRepo,
        '-s',
        'read-only',
        '--output-schema',
        schemaPath,
        '-'
      );
      return {
        command: 'codex',
        args,
        cwd: nodeRepo,
        cleanup,
        identity: ['codex', ...args.filter((arg) => arg !== schemaPath)].join(' ')
      };
    }
    case 'claude': {
      const args = ['-p'];
      if (model) {
        args.push('--model', model);
      }
      args.push(
        '--permission-mode',
        'dontAsk',
        '--tools',
        'Read,Grep,Glob',
        '--output-format',
        'text',
        '--json-schema',
        JSON.stringify(LLM_OUTPUT_SCHEMA)
      );
      return {
        command: 'claude',
        args,
        cwd: nodeRepo,
        identity: ['claude', ...args].join(' ')
      };
    }
    case 'copilot':
      return {
        command: 'copilot',
        args: ['-p'],
        cwd: nodeRepo,
        identity: 'copilot -p'
      };
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

function cacheDir() {
  return path.join(process.cwd(), CACHE_FOLDER);
}

function cacheKey({ provider, model, reportId, prompt }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      provider,
      model,
      reportId,
      prompt
    }))
    .digest('hex');
}

function readCachedAssessment(key) {
  const file = path.join(cacheDir(), `${key}.json`);
  if (!fs.existsSync(file)) return;
  const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cached.assessment ?? cached;
}

function writeCachedAssessment(key, assessment, metadata = {}) {
  fs.mkdirSync(cacheDir(), { recursive: true });
  const file = path.join(cacheDir(), `${key}.json`);
  const cache = {
    assessment
  };
  if (metadata.comment) {
    cache.comment = metadata.comment;
  }
  fs.writeFileSync(file, JSON.stringify(cache, null, 2) + '\n');
}

// This is the actual prompt sent to Codex, Claude, Copilot, or --llm-command.
// The command receives it on stdin and must return JSON matching
// LLM_OUTPUT_SCHEMA. Keep this prompt explicit about SECURITY.md and doc/
// because the model should make a threat-model decision from Node.js sources,
// not only from reporter-controlled HackerOne text.
function buildLLMPrompt(report, heuristic, nodeRepo, allReports) {
  const payload = getReportPromptPayload(report, heuristic, allReports);
  return `You are assessing a private HackerOne report for Node.js core.

Use the local Node.js checkout at:
${nodeRepo}

Before deciding, read SECURITY.md and inspect relevant documentation under
doc/. At minimum, use SECURITY.md for the threat model and search doc/ for APIs,
subsystems, stability notes, warnings, and documented behavior related to this
report. Treat application code, caller-supplied API inputs, third-party modules,
unsupported platforms, and inspector/debugger access according to SECURITY.md.

Assess whether the report is valid under the Node.js threat model and whether
the current severity/CVSS is correct. Use comparable_reports_same_weakness as
precedent context when present, especially the team summaries and historical
severity/CVSS choices, but do not copy prior decisions blindly if SECURITY.md or
current documentation points to a different result. Confidence must be an
integer from 0 to 100, where 100 means very high confidence. Return only JSON
matching this schema:

${JSON.stringify(LLM_OUTPUT_SCHEMA, null, 2)}

Report:
${JSON.stringify(payload, null, 2)}
`;
}

function runLLM(commandConfig, prompt) {
  return new Promise((resolve) => {
    const child = spawn(commandConfig.command, commandConfig.args, {
      cwd: commandConfig.cwd,
      shell: commandConfig.shell,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ error: error.message, stdout, stderr });
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ error: `LLM command exited with ${code}`, stdout, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.end(prompt);
  });
}

function extractJSON(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const first = stdout.indexOf('{');
    const last = stdout.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      throw new Error('LLM output did not contain a JSON object');
    }
    return JSON.parse(stdout.slice(first, last + 1));
  }
}

async function assessOneReportWithLLM({
  report,
  result,
  index,
  total,
  reports,
  argv,
  cli,
  provider,
  model,
  modelInfo,
  nodeRepo,
  commandConfig
}) {
  const shouldAssess = await promptBeforeLLMAssessment(
    result,
    argv,
    cli,
    index,
    total
  );
  if (!shouldAssess) {
    result.llm = {
      provider,
      skipped: true
    };
    return true;
  }

  const prompt = buildLLMPrompt(report, result, nodeRepo, reports);
  const key = cacheKey({
    provider,
    model,
    reportId: result.id,
    prompt
  });

  if (argv['validate-reports-cache']) {
    const cached = readCachedAssessment(key);
    if (cached) {
      result.llm = {
        provider,
        model,
        cached: true,
        assessment: cached
      };
      cli.ok(`Using cached LLM assessment for H1 report ${result.id}`);
      return promptAfterLLMAssessment(result, argv, cli);
    }
  }

  cli.startSpinner(
    `Asking ${provider} to assess H1 report ${result.id} (${index}/${total})...`
  );
  const response = await runLLM(commandConfig, prompt);

  if (response.error) {
    result.llm = {
      provider,
      error: response.error,
      stderr: response.stderr.trim()
    };
    cli.stopSpinner(
      `LLM assessment failed for H1 report ${result.id}`,
      cli.SPINNER_STATUS.WARN
    );
    return promptAfterLLMAssessment(result, argv, cli);
  }

  try {
    result.llm = {
      provider,
      model,
      assessment: extractJSON(response.stdout)
    };
    if (argv['validate-reports-cache']) {
      writeCachedAssessment(key, result.llm.assessment, {
        comment: modelInfo.comment
      });
    }
    cli.stopSpinner(`LLM assessment completed for H1 report ${result.id}`);
  } catch (error) {
    result.llm = {
      provider,
      error: error.message,
      stdout: response.stdout.trim(),
      stderr: response.stderr.trim()
    };
    cli.stopSpinner(
      `Could not parse LLM assessment for H1 report ${result.id}`,
      cli.SPINNER_STATUS.WARN
    );
  }

  return promptAfterLLMAssessment(result, argv, cli);
}

async function assessReportsWithLLM(reports, results, argv, cli) {
  const nodeRepo = path.resolve(argv['node-repo'] ?? process.cwd());
  const provider = argv.llm;
  const explicitModel = argv['llm-model'];
  const modelInfo = inferLLMModel(provider, explicitModel);
  const model = modelInfo.model;
  const commandConfig = buildProviderCommand(
    provider,
    nodeRepo,
    argv['llm-command'],
    explicitModel
  );

  try {
    for (let i = 0; i < reports.length; i++) {
      const shouldContinue = await assessOneReportWithLLM({
        report: reports[i],
        result: results[i],
        index: i + 1,
        total: reports.length,
        reports,
        argv,
        cli,
        provider,
        model,
        modelInfo,
        nodeRepo,
        commandConfig
      });
      if (!shouldContinue) break;
    }
  } finally {
    commandConfig.cleanup?.();
  }
}

async function promptBeforeLLMAssessment(result, argv, cli, index, total) {
  if (!argv['validate-reports-confirm']) {
    return true;
  }

  cli.separator(`H1 ${result.id} (${index}/${total})`);
  cli.log([
    `${style.bold('Report')} ${style.cyan(result.url)}`,
    `${style.bold('Title')}  ${result.title}`,
    `${style.bold('Severity')} ${result.severity.current || 'unset'}`,
    `${style.bold('CVSS')} ${result.severity.cvssVector || 'unset'}`,
    `${style.bold('Weakness')} ${result.weakness.id || 'unset'} ` +
      `${result.weakness.name || ''}`.trim()
  ].join('\n'));

  return cli.prompt(`Assess H1 report ${result.id}: ${result.title}?`, {
    defaultAnswer: true
  });
}

async function promptAfterLLMAssessment(result, argv, cli) {
  cli.separator(`H1 ${result.id} LLM Assessment`);
  cli.log(llmAssessmentToMarkdown(result));

  if (!argv['validate-reports-confirm']) {
    return true;
  }

  return cli.prompt('Continue to the next report?', {
    defaultAnswer: true
  });
}

export default class ValidateReports {
  constructor(cli, argv = {}) {
    this.cli = cli;
    this.argv = argv;
  }

  async validate() {
    const credentials = await auth({
      github: false,
      h1: true
    });
    const req = new Request(credentials);

    this.cli.startSpinner('Fetching triaged HackerOne reports...');
    const reports = await fetchAllTriagedReports(
      req,
      this.argv['validate-reports-limit']
    );
    this.cli.stopSpinner(`Fetched ${reports.length} triaged HackerOne reports`);

    const results = reports.map(assessReport);
    if (this.argv.llm) {
      await assessReportsWithLLM(reports, results, this.argv, this.cli);
    }

    const format = this.argv['validate-reports-format'] ?? 'markdown';
    const output = format === 'json'
      ? JSON.stringify(results, null, 2) + '\n'
      : toMarkdown(results);

    if (this.argv['validate-reports-output']) {
      fs.writeFileSync(this.argv['validate-reports-output'], output);
      this.cli.ok(
        `Wrote report validation output to ${this.argv['validate-reports-output']}`
      );
    } else {
      this.cli.log(output);
    }
  }
}
