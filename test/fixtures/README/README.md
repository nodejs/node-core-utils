<p align="center">
  <a href="https://nodejs.org/">
    <img alt="Node.js" src="https://nodejs.org/static/images/logo-light.svg" width="400"/>
  </a>
</p>
<p align="center">
  <a title="CII Best Practices" href="https://bestpractices.coreinfrastructure.org/projects/29"><img src="https://bestpractices.coreinfrastructure.org/projects/29/badge"></a>
</p>

Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine. Node.js
uses an event-driven, non-blocking I/O model that makes it lightweight and
efficient. The Node.js package ecosystem, [npm][], is the largest ecosystem of
open source libraries in the world.

The Node.js project is supported by the
[Node.js Foundation](https://nodejs.org/en/foundation/). Contributions,
policies, and releases are managed under an
[open governance model](./GOVERNANCE.md).

**This project is bound by a [Code of Conduct][].**

If you need help using or installing Node.js, please use the
[nodejs/help](https://github.com/nodejs/help) issue tracker.


# Table of Contents

* [Resources for Newcomers](#resources-for-newcomers)
* [Release Types](#release-types)
  * [Download](#download)
    * [Current and LTS Releases](#current-and-lts-releases)
    * [Nightly Releases](#nightly-releases)
    * [API Documentation](#api-documentation)
  * [Verifying Binaries](#verifying-binaries)
* [Building Node.js](#building-nodejs)
  * [Security](#security)
  * [Current Project Team Members](#current-project-team-members)
    * [TSC (Technical Steering Committee)](#tsc-technical-steering-committee)
    * [Collaborators](#collaborators)
    * [Release Team](#release-team)

## Resources for Newcomers

### Official Resources

* [Website][]
* [Node.js Help][]
* [Contributing to the project][]
* IRC (node core development): [#node-dev on chat.freenode.net][]

### Unofficial Resources

* IRC (general questions): [#node.js on chat.freenode.net][]. Please see
<http://nodeirc.info/> for more information regarding the `#node.js` IRC
channel.

_Please note that unofficial resources are neither managed by (nor necessarily
endorsed by) the Node.js TSC. Specifically, such resources are not
currently covered by the [Node.js Moderation Policy][] and the selection and
actions of resource operators/moderators are not subject to TSC oversight._

## Release Types

The Node.js project maintains multiple types of releases:

* **Current**: Released from active development branches of this repository,
  versioned by [SemVer](http://semver.org/) and signed by a member of the
  [Release Team](#release-team).
  Code for Current releases is organized in this repository by major version
  number. For example: [v4.x](https://github.com/nodejs/node/tree/v4.x).
  The major version number of Current releases will increment every 6 months
  allowing for breaking changes to be introduced. This happens in April and
  October every year. Current release lines beginning in October each year have
  a maximum support life of 8 months. Current release lines beginning in April
  each year will convert to LTS (see below) after 6 months and receive further
  support for 30 months.
* **LTS**: Releases that receive Long-term Support, with a focus on stability
  and security. Every second Current release line (major version) will become an
  LTS line and receive 18 months of _Active LTS_ support and a further 12
  months of _Maintenance_. LTS release lines are given alphabetically
  ordered codenames, beginning with v4 Argon. LTS releases are less frequent
  and will attempt to maintain consistent major and minor version numbers,
  only incrementing patch version numbers. There are no breaking changes or
  feature additions, except in some special circumstances.
* **Nightly**: Versions of code in this repository on the current Current
  branch, automatically built every 24-hours where changes exist. Use with
  caution.

More information can be found in the [LTS README](https://github.com/nodejs/LTS/).

## Download

Binaries, installers, and source tarballs are available at
<https://nodejs.org>.

#### Current and LTS Releases
**Current** and **LTS** releases are available at
<https://nodejs.org/download/release/>, listed under their version strings.
The [latest](https://nodejs.org/download/release/latest/) directory is an
alias for the latest Current release. The latest LTS release from an LTS
line is available in the form: latest-_codename_. For example:
<https://nodejs.org/download/release/latest-argon>.

#### Nightly Releases
**Nightly** builds are available at
<https://nodejs.org/download/nightly/>, listed under their version
string which includes their date (in UTC time) and the commit SHA at
the HEAD of the release.

#### API Documentation
**API documentation** is available in each release and nightly
directory under _docs_. <https://nodejs.org/api/> points to the API
documentation of the latest stable version.

### Verifying Binaries

Current, LTS and Nightly download directories all contain a _SHASUMS256.txt_
file that lists the SHA checksums for each file available for
download.

The _SHASUMS256.txt_ can be downloaded using curl.

```console
$ curl -O https://nodejs.org/dist/vx.y.z/SHASUMS256.txt
```

To check that a downloaded file matches the checksum, run
it through `sha256sum` with a command such as:

```console
$ grep node-vx.y.z.tar.gz SHASUMS256.txt | sha256sum -c -
```

_(Where "node-vx.y.z.tar.gz" is the name of the file you have
downloaded)_

Additionally, Current and LTS releases (not Nightlies) have the GPG
detached signature of SHASUMS256.txt available as SHASUMS256.txt.sig.
You can use `gpg` to verify that SHASUMS256.txt has not been tampered with.

To verify SHASUMS256.txt has not been altered, you will first need to import
all of the GPG keys of individuals authorized to create releases. They are
listed at the bottom of this README under [Release Team](#release-team).
Use a command such as this to import the keys:

```console
$ gpg --keyserver pool.sks-keyservers.net --recv-keys DD8F2338BAE7501E3DD5AC78C273792F7D83545D
```

_(See the bottom of this README for a full script to import active
release keys)_

Next, download the SHASUMS256.txt.sig for the release:

```console
$ curl -O https://nodejs.org/dist/vx.y.z/SHASUMS256.txt.sig
```

After downloading the appropriate SHASUMS256.txt and SHASUMS256.txt.sig files,
you can then use `gpg --verify SHASUMS256.txt.sig SHASUMS256.txt` to verify
that the file has been signed by an authorized member of the Node.js team.

Once verified, use the SHASUMS256.txt file to get the checksum for
the binary verification command above.

## Building Node.js

See [BUILDING.md](BUILDING.md) for instructions on how to build
Node.js from source. The document also contains a list of
officially supported platforms.

## Security

All security bugs in Node.js are taken seriously and should be reported by
emailing security@nodejs.org. This will be delivered to a subset of the project
team who handle security issues. Please don't disclose security bugs
publicly until they have been handled by the security team.

Your email will be acknowledged within 24 hours, and you’ll receive a more
detailed response to your email within 48 hours indicating the next steps in
handling your report.

There are no hard and fast rules to determine if a bug is worth reporting as
a security issue. The general rule is any issue worth reporting
must allow an attacker to compromise the confidentiality, integrity
or availability of the Node.js application or its system for which the attacker
does not already have the capability.

To illustrate the point, here are some examples of past issues and what the
Security Reponse Team thinks of them. When in doubt, however, please do send
us a report nonetheless.


### Public disclosure preferred

- [#14519](https://github.com/nodejs/node/issues/14519): _Internal domain
  function can be used to cause segfaults_. Causing program termination using
  either the public Javascript APIs or the private bindings layer APIs requires
  the ability to execute arbitrary Javascript code, which is already the highest
  level of privilege possible.

- [#12141](https://github.com/nodejs/node/pull/12141): _buffer: zero fill
  Buffer(num) by default_. The buffer constructor behaviour was documented,
  but found to be prone to [mis-use](https://snyk.io/blog/exploiting-buffer/).
  It has since been changed, but despite much debate, was not considered misuse
  prone enough to justify fixing in older release lines and breaking our
  API stability contract.

### Private disclosure preferred

- [CVE-2016-7099](https://nodejs.org/en/blog/vulnerability/september-2016-security-releases/):
  _Fix invalid wildcard certificate validation check_. This is a high severity
  defect that would allow a malicious TLS server to serve an invalid wildcard
  certificate for its hostname and be improperly validated by a Node.js client.

- [#5507](https://github.com/nodejs/node/pull/5507): _Fix a defect that makes
  the CacheBleed Attack possible_. Many, though not all, OpenSSL vulnerabilities
  in the TLS/SSL protocols also effect Node.js.

- [CVE-2016-2216](https://nodejs.org/en/blog/vulnerability/february-2016-security-releases/):
  _Fix defects in HTTP header parsing for requests and responses that can allow
  response splitting_. While the impact of this vulnerability is application and
  network dependent, it is remotely exploitable in the HTTP protocol.

When in doubt, please do send us a report.


## Current Project Team Members

The Node.js project team comprises a group of core collaborators and a sub-group
that forms the _Technical Steering Committee_ (TSC) which governs the project.
For more information about the governance of the Node.js project, see
[GOVERNANCE.md](./GOVERNANCE.md).

### TSC (Technical Steering Committee)

* [bar](https://github.com/bar) -
  **Bar User** \<bar@example.com> (she/her)

### TSC emeriti

* [test](https://github.com/test) -
**Test** &lt;test@example.com&gt;

### Collaborators

* [bar](https://github.com/bar) -
  **Bar User** \<bar@example.com> (she/her)
* [Baz](https://github.com/Baz) -
**Baz User** &lt;baz@example.com&gt; (he/him)
* [foo](https://github.com/foo) -
**Foo User** &lt;foo@example.com&gt; (she/her)
* [Quo](https://github.com/quo) -
**Quo User** &lt;quo@example.com&gt; (she/her)
* [Quux](https://github.com/quux) -
**Quux User** &lt;quux@example.com&gt; (he/him)
* [ExtraSpace](https://github.com/extraspace) -
**Extra Space**  &lt;extraspace@example.com&gt; (he/him)

### Collaborator emeriti

* [bee](https://github.com/bee) -
**bee** &lt;bee@example.com&gt;

Collaborators follow the [COLLABORATOR_GUIDE.md](./COLLABORATOR_GUIDE.md) in
maintaining the Node.js project.

### Release Team

Node.js releases are signed with one of the following GPG keys:

* **Colin Ihrig** &lt;cjihrig@example.com&gt;
`94AE36675C464D64BAFA68DD7434390BDBE9B9C5`
* **Evan Lucas** &lt;evanlucas@me.com&gt;
`B9AE9905FFD7803F25714661B63B535A4C206CA9`
* **Gibson Fahnestock** &lt;gibfahn@example.com&gt;
`77984A986EBC2AA786BC0F66B01FBB92821C587A`
* **Italo A. Casas** &lt;me@italoacasas.com&gt;
`56730D5401028683275BD23C23EFEFE93C4CFFFE`
* **James M Snell** &lt;jasnell@keybase.io&gt;
`71DCFD284A79C3B38668286BC97EC7A07EDE3FC1`
* **Jeremiah Senkpiel** &lt;fishrock@keybase.io&gt;
`FD3A5288F042B6850C66B31F09FE44734EB7990E`
* **Myles Borins** &lt;myles.borins@example.com&gt;
`C4F0DFFF4E8C1A8236409D08E73BC641CC11F4C8`
* **Rod Vagg** &lt;rod@vagg.org&gt;
`DD8F2338BAE7501E3DD5AC78C273792F7D83545D`

The full set of trusted release keys can be imported by running:

```shell
gpg --keyserver pool.sks-keyservers.net --recv-keys 94AE36675C464D64BAFA68DD7434390BDBE9B9C5
gpg --keyserver pool.sks-keyservers.net --recv-keys FD3A5288F042B6850C66B31F09FE44734EB7990E
gpg --keyserver pool.sks-keyservers.net --recv-keys 71DCFD284A79C3B38668286BC97EC7A07EDE3FC1
gpg --keyserver pool.sks-keyservers.net --recv-keys DD8F2338BAE7501E3DD5AC78C273792F7D83545D
gpg --keyserver pool.sks-keyservers.net --recv-keys C4F0DFFF4E8C1A8236409D08E73BC641CC11F4C8
gpg --keyserver pool.sks-keyservers.net --recv-keys B9AE9905FFD7803F25714661B63B535A4C206CA9
gpg --keyserver pool.sks-keyservers.net --recv-keys 56730D5401028683275BD23C23EFEFE93C4CFFFE
gpg --keyserver pool.sks-keyservers.net --recv-keys 77984A986EBC2AA786BC0F66B01FBB92821C587A
```

See the section above on [Verifying Binaries](#verifying-binaries) for details
on what to do with these keys to verify that a downloaded file is official.

Previous releases may also have been signed with one of the following GPG keys:

* **Chris Dickinson** &lt;christopher.s.dickinson@example.com&gt;
`9554F04D7259F04124DE6B476D5A82AC7E37093B`
* **Isaac Z. Schlueter** &lt;i@izs.me&gt;
`93C7E9E91B49E432C2F75674B0A78B0A6C481CF6`
* **Julien Gilli** &lt;jgilli@fastmail.fm&gt;
`114F43EE0176B71C7BC219DD50A3051F888C628D`
* **Timothy J Fontaine** &lt;tjfontaine@example.com&gt;
`7937DFD2AB06298B2293C3187D33FF9D0246406D`

### Working Groups

Information on the current Node.js Working Groups can be found in the
[TSC repository](https://github.com/nodejs/TSC/blob/main/WORKING_GROUPS.md).

[npm]: https://www.npmjs.com
[Website]: https://nodejs.org/en/
[Contributing to the project]: CONTRIBUTING.md
[Node.js Help]: https://github.com/nodejs/help
[Node.js Moderation Policy]: https://github.com/nodejs/TSC/blob/main/Moderation-Policy.md
[#node.js on chat.freenode.net]: https://webchat.freenode.net?channels=node.js&uio=d4
[#node-dev on chat.freenode.net]: https://webchat.freenode.net?channels=node-dev&uio=d4
[Code of Conduct]: https://github.com/nodejs/TSC/blob/main/CODE_OF_CONDUCT.md
