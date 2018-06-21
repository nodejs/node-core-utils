Failures in job https://ci.nodejs.org/job/node-test-pull-request/15449/

#### [label=rhel72-s390x](https://ci.nodejs.org/job/node-test-commit-linuxone/label=rhel72-s390x/2220/console)

<details>
<summary>See failures on test-linuxonecc-rhel72-s390x-3:</summary>

```
ERROR: Error fetching remote repo 'origin'
hudson.plugins.git.GitException: Failed to fetch from git@github.com:nodejs/node.git
	at hudson.plugins.git.GitSCM.fetchFrom(GitSCM.java:889)
	at hudson.plugins.git.GitSCM.retrieveChanges(GitSCM.java:1146)
	at hudson.plugins.git.GitSCM.checkout(GitSCM.java:1177)
	at hudson.scm.SCM.checkout(SCM.java:504)
```
</details>

