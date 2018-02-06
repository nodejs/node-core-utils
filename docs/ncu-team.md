# ncu-team

Listing members of a specific team, synchronize special blocks in files with
the list of members.

## Usage

### List the members in a team

The members will be sorted alphabetically by their login.

```
$ ncu-team list automation-collaborators

- [@evanlucas](https://github.com/evanlucas) - Evan Lucas
- [@joyeecheung](https://github.com/joyeecheung) - Joyee Cheung
- [@MylesBorins](https://github.com/MylesBorins) - Myles Borins
- [@nodejs-github-bot](https://github.com/nodejs-github-bot) - Node.js GitHub Bot
- [@rvagg](https://github.com/rvagg) - Rod Vagg
- [@targos](https://github.com/targos) - Michaël Zasso
```

### Synchronize files with special blocks

`ncu-team sync` updates the special block `<!-- ncu-team-sync.team($org/$team) -->`
with a list of members under the specified team.

For example, if there is a file named `README.md` with text like this:

```markdown
## Collaborators in the automation team

<!-- ncu-team-sync.team(nodejs/automation-collaborators) -->

<!-- ncu-team-sync end -->

## Bots in the Node.js organization

<!-- ncu-team-sync.team(nodejs/bots) -->

<!-- ncu-team-sync end -->
```

Running this command:

```
$ ncu-team sync README.md
```

will update the file with text like this:

```markdown
## Collaborators in the automation team

<!-- ncu-team-sync.team(nodejs/automation-collaborators) -->

- [@evanlucas](https://github.com/evanlucas) - Evan Lucas
- [@joyeecheung](https://github.com/joyeecheung) - Joyee Cheung
- [@MylesBorins](https://github.com/MylesBorins) - Myles Borins
- [@nodejs-github-bot](https://github.com/nodejs-github-bot) - Node.js GitHub Bot
- [@rvagg](https://github.com/rvagg) - Rod Vagg
- [@targos](https://github.com/targos) - Michaël Zasso

<!-- ncu-team-sync end -->

## Bots in the Node.js organization

<!-- ncu-team-sync.team(nodejs/bots) -->

- [@nodejs-github-bot](https://github.com/nodejs-github-bot) - Node.js GitHub Bot

<!-- ncu-team-sync end -->
```
