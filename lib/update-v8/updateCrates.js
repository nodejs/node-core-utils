import semver from 'semver';
import * as TOML from 'smol-toml';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { removeDirectory } from './util.js';
import { forceRunAsync } from '../run.js';

export default function updateCrates() {
  return {
    title: 'Update Rust crates',
    skip: (ctx) => ctx.newVersion.majorMinor < 139,
    task: (ctx, task) => {
      return task.newListr([
        enumerateTemporalDependencies(),
        removeExistingCrates(),
        vendorCrates(),
        fetchPlaceholderCrates(),
        buildManifest(),
        generateLockfile(),
        updateGYP(),
        commitChanges()
      ]);
    }
  };
}

const chromiumCratesDir = 'deps/v8/third_party/rust/chromium_crates_io';
const nodeCratesDir = 'deps/crates';

function enumerateTemporalDependencies() {
  return {
    title: 'Enumerate Temporal dependency tree',
    task: async(ctx) => {
      // Resolve against the vendored crates rather than crates.io. Chromium patches some
      // vendored manifests (e.g. relaxing version pins), and the lockfile only resolves
      // with those patches applied.
      const tree = await forceRunAsync(
        ctx.cargo,
        [
          'tree', '-Z', 'bindeps', '--package', 'temporal_capi', '--prefix', 'none',
          '--config', 'source.crates-io.replace-with="vendored-sources"',
          '--config', 'source.vendored-sources.directory="vendor"'
        ],
        {
          ignoreFailure: false,
          captureStdout: true,
          spawnArgs: {
            cwd: path.join(ctx.nodeDir, chromiumCratesDir),
            env: { ...process.env, RUSTC_BOOTSTRAP: '1' }
          }
        }
      );
      const crates = new Set();
      for (const crate of tree.trimEnd().split('\n').sort()) {
        const [name, version] = crate.split(' ', 2);
        crates.add(`${name}@${version.substring(1)}`);
      }
      ctx.temporalCrates = crates;
    },
  };
}

function removeExistingCrates() {
  return {
    title: 'Remove existing crates',
    task: (ctx) => removeDirectory(path.join(ctx.nodeDir, nodeCratesDir, 'vendor'))
  };
}

// Note that the crates vendored in third_party/rust/chromium_crates_io already have any custom
// Chromium patches applied by gnrt, so we don't need to worry about patching them ourselves.
function vendorCrates() {
  return {
    title: 'Copy vendored crates',
    task: async(ctx, task) => {
      const chromiumVendor = path.join(ctx.nodeDir, chromiumCratesDir, 'vendor');
      const nodeVendor = path.join(ctx.nodeDir, nodeCratesDir, 'vendor');
      await fs.mkdir(nodeVendor);

      const subtasks = [];
      ctx.rustVersions = [];
      ctx.placeholderCrates = [];
      for (const dir of await fs.readdir(chromiumVendor)) {
        const crate = await getCrateInfo(dir);
        if (!crate || !ctx.temporalCrates.has(`${crate.name}@${crate.version}`)) continue;
        if (crate.name === 'temporal_capi') {
          ctx.temporalCAPIDirectory = dir;
        }
        // Fetch replace_with placeholders from crates.io.
        // This is a stop-gap fix that only works as long as the
        // See https://chromium-review.googlesource.com/c/chromium/src/+/8527739
        if (crate.metadata?.gnrt?.is_placeholder) {
          ctx.placeholderCrates.push({ dir, name: crate.name, version: crate.version });
          continue;
        }
        if (crate['rust-version']) {
          ctx.rustVersions.push(crate['rust-version']);
        }
        subtasks.push({
          title: dir,
          task: async(ctx) => {
            await fs.cp(
              path.join(chromiumVendor, dir),
              path.join(nodeVendor, dir),
              { recursive: true }
            );
          }
        });
      }

      return task.newListr(subtasks, { concurrent: ctx.concurrent });

      async function getCrateInfo(crate) {
        try {
          const manifest = TOML.parse(
            await fs.readFile(path.join(chromiumVendor, crate, 'Cargo.toml'), 'utf8')
          );
          return manifest.package;
        } catch {
          return null;
        }
      }
    }
  };
}

// TODO(joyeecheung): Instead of fetching the crates from crates.io,
// generate the replacement crates from Chromium's data. e.g.
// For `replace_with = "//third_party/rust/icu4x_data:lib"`
// in gnrt_config.toml, copy the `.rs.data` files that the dependent
// crates use (`impl_<marker>!(Baked)` in their provider.rs) from
// third_party/rust/icu4x_data/src/data/common and generate a data/mod.rs in the
// upstream crate layout.
// See https://github.com/nodejs/node-core-utils/pull/1117
function fetchPlaceholderCrates() {
  return {
    title: 'Fetch placeholder crates from crates.io',
    skip: (ctx) => ctx.placeholderCrates.length === 0 && 'No placeholder crates',
    task: async(ctx) => {
      const nodeVendor = path.join(ctx.nodeDir, nodeCratesDir, 'vendor');
      const chromiumPatches = path.join(ctx.nodeDir, chromiumCratesDir, 'patches');
      for (const { dir, name } of ctx.placeholderCrates) {
        try {
          await fs.access(path.join(chromiumPatches, dir));
        } catch {
          continue;
        }
        throw new Error(`Detected Chromium patches ${name} in ${chromiumPatches}/${dir}, ` +
          'the stop-gap fix of fetching crates from crates.io no longer work.');
      }

      // Vendor a temporary package that depends on on the crates to fetch them.
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-crates-'));
      try {
        const manifest = {
          package: { name: 'placeholder_crates', version: '0.0.0', edition: '2021' },
          dependencies: Object.fromEntries(ctx.placeholderCrates.map(({ name, version }) => (
            [name, { version: `=${version}`, 'default-features': false }]
          )))
        };
        await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), TOML.stringify(manifest));
        await fs.mkdir(path.join(tmpDir, 'src'));
        await fs.writeFile(path.join(tmpDir, 'src/lib.rs'), '');
        const vendorDir = path.join(tmpDir, 'vendor');
        await forceRunAsync(ctx.cargo, ['vendor', '--quiet', '--versioned-dirs', vendorDir], {
          ignoreFailure: false,
          spawnArgs: { cwd: tmpDir }
        });

        for (const { dir, name, version } of ctx.placeholderCrates) {
          const dest = path.join(nodeVendor, dir);
          await fs.cp(path.join(vendorDir, `${name}-${version}`), dest, { recursive: true });
          await fs.writeFile(path.join(dest, '.cargo-checksum.json'), '{"files":{}}\n');
          const crate = TOML.parse(await fs.readFile(path.join(dest, 'Cargo.toml'), 'utf8'));
          if (crate.package['rust-version']) {
            ctx.rustVersions.push(crate.package['rust-version']);
          }
        }
      } finally {
        await removeDirectory(tmpDir);
      }
    }
  };
}

function buildManifest() {
  return {
    title: 'Build new manifest',
    task: async(ctx) => {
      if (ctx.rustVersions.length) {
        const msrv = ctx.rustVersions.map(semver.coerce)
          .reduce((a, b) => (semver.gt(a, b) ? a : b));
        ctx.msrv = `${msrv.major}.${msrv.minor}`;
      }

      const sourceManifest = TOML.parse(
        await fs.readFile(path.join(ctx.nodeDir, chromiumCratesDir, 'Cargo.toml'), 'utf8')
      );

      const header =
      '# This manifest is generated by node-core-utils. Do not modify it directly.\n\n';
      const manifest = {
        package: {
          edition: sourceManifest.package.edition,
          name: 'node_crates',
          version: `${ctx.newVersion.major}.${ctx.newVersion.minor}.${ctx.newVersion.build}`
        },
        lib: {
          'crate-type': ['staticlib']
        },
        dependencies: {}
      };
      if (ctx.msrv) {
        manifest.package['rust-version'] = ctx.msrv;
      }
      for (const crate of ctx.temporalCrates) {
        const name = crate.split('@', 1)[0];
        if (name === 'temporal_capi' || typeof sourceManifest.dependencies[name] === 'object') {
          manifest.dependencies[name] = sourceManifest.dependencies[name];
        }
      }

      const cargoTOML = header + TOML.stringify(manifest);
      await fs.writeFile(path.join(ctx.nodeDir, nodeCratesDir, 'Cargo.toml'), cargoTOML);
    },
  };
}

function generateLockfile() {
  return {
    title: 'Generate lockfile',
    task: (ctx) => forceRunAsync(ctx.cargo, ['generate-lockfile', '--quiet', '--offline'], {
      ignoreFailure: false,
      spawnArgs: { cwd: path.join(ctx.nodeDir, nodeCratesDir) }
    })
  };
}

function updateGYP() {
  return {
    title: 'Update include path in crates.gyp',
    task: async(ctx, task) => {
      const filePath = path.join(ctx.nodeDir, nodeCratesDir, 'crates.gyp');
      let gyp = await fs.readFile(filePath, 'utf8');
      const [definition, currentDirectory] = gyp.match(/'temporal_capi_dir': '(.+?)'/);
      if (currentDirectory === ctx.temporalCAPIDirectory) {
        task.skip('crates.gyp already up-to-date');
        return;
      }
      gyp = gyp.replace(definition, `'temporal_capi_dir': '${ctx.temporalCAPIDirectory}'`);
      await fs.writeFile(filePath, gyp);
    }
  };
}

function commitChanges() {
  return {
    title: 'Commit changes',
    task: async(ctx) => {
      await ctx.execGitNode('add', ['--force', 'deps/crates']);
      await ctx.execGitNode(
        'commit',
        ['-m', `deps: update Rust crates for V8 ${ctx.newVersion}`]
      );
    }
  };
}
