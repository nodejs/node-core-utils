## Planning

* [X] Open an [issue](https://github.com/nodejs-private/node-private) titled
  `Next Security Release`, and put this checklist in the description.

* [ ] Get agreement on the list of vulnerabilities to be addressed:
%REPORTS%

* [ ] PR release announcements in [private](https://github.com/nodejs-private/nodejs.org-private):
  * [ ] pre-release: %PRE_RELEASE_PRIV%
  * [ ] post-release: %POS_RELEASE_PRIV%
    * List vulnerabilities in order of descending severity
    * Ask the HackerOne reporter if they would like to be credited on the
      security release blog page

* [ ] Get agreement on the planned date for the release: %RELEASE_DATE%

* [ ] Get release team volunteers for all affected lines:
%AFFECTED_LINES%

## Announcement (one week in advance of the planned release)

* [ ] Verify that GitHub Actions are working as normal: <https://www.githubstatus.com/>.

* [ ] Check that all vulnerabilities are ready for release integration:
  * PRs against all affected release lines or cherry-pick clean
  * Approved
  * (optional) Approved by the reporter
    * Build and send the binary to the reporter according to its architecture
      and ask for a review. This step is important to avoid insufficient fixes
      between Security Releases.
  * Have CVEs
    * Make sure that dependent libraries have CVEs for their issues. We should
      only create CVEs for vulnerabilities in Node.js itself. This is to avoid
      having duplicate CVEs for the same vulnerability.
  * Described in the pre/post announcements

* [ ] Pre-release announcement to nodejs.org blog: TBD
  (Re-PR the pre-approved branch from nodejs-private/nodejs.org-private to
  nodejs/nodejs.org)

* [ ] Pre-release announcement [email](https://groups.google.com/forum/#!forum/nodejs-sec): TBD
  * Subject: `Node.js security updates for all active release lines, Month Year`

* [ ] CC `oss-security@lists.openwall.com` on pre-release
  * [ ] Forward the email you receive to `oss-security@lists.openwall.com`.

* [ ] Create a new issue in [nodejs/tweet](https://github.com/nodejs/tweet/issues)

* [ ] Request releaser(s) to start integrating the PRs to be released.

* [ ] Notify [docker-node](https://github.com/nodejs/docker-node/issues) of upcoming security release date:  TBD

* [ ] Notify build-wg of upcoming security release date by opening an issue
  in [nodejs/build](https://github.com/nodejs/build/issues) to request WG members are available to fix any CI issues: TBD

## Release day

* [ ] [Lock CI](https://github.com/nodejs/build/blob/HEAD/doc/jenkins-guide.md#before-the-release)

* [ ] The releaser(s) run the release process to completion.

* [ ] [Unlock CI](https://github.com/nodejs/build/blob/HEAD/doc/jenkins-guide.md#after-the-release)

* [ ] Post-release announcement to Nodejs.org blog:
  * (Re-PR the pre-approved branch from nodejs-private/nodejs.org-private to
    nodejs/nodejs.org)

* [ ] Post-release announcement in reply email: TBD

* [ ] Notify `#nodejs-social` about the release.

* [ ] Comment in [docker-node][] issue that release is ready for integration.
  The docker-node team will build and release docker image updates.

* [ ] For every H1 report resolved:
  * Close as Resolved
  * Request Disclosure
  * Request publication of H1 CVE requests
    * (Check that the "Version Fixed" field in the CVE is correct, and provide
      links to the release blogs in the "Public Reference" section)

* [ ] PR machine-readable JSON descriptions of the vulnerabilities to the
  [core](https://github.com/nodejs/security-wg/tree/HEAD/vuln/core)
  vulnerability DB.
  * For each vulnerability add a `#.json` file, one can copy an existing
    [json](https://github.com/nodejs/security-wg/blob/0d82062d917cb9ddab88f910559469b2b13812bf/vuln/core/78.json)
    file, and increment the latest created file number and use that as the name
    of the new file to be added. For example, `79.json`.

* [ ] Close this issue

* [ ] Make sure the PRs for the vulnerabilities are closed.

* [ ] PR in that you stewarded the release in
  [Security release stewards](https://github.com/nodejs/node/blob/HEAD/doc/contributing/security-release-process.md#security-release-stewards).
  If necessary add the next rotation of the steward rotation.
