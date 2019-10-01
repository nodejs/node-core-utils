# ncu-config

Configure variables for node-core-utils to use. Global variables are stored
in `~/.ncurc`, project variables (committed to the repository) are stored in
`$PWD/.ncurc` and local variables (shouldn't be committed) are stored in
`$PWD/.ncu/config`.

```
ncu-config <command>

Commands:
  ncu-config set <key> <value>  Set a config variable
  ncu-config get <key>          Get a config variable
  ncu-config list               List the configurations

Options:
  --version      Show version number                                   [boolean]
  --global, -g   Use global config (~/.ncurc)                          [boolean]
  --project, -p  Use project config (./.ncurc)                         [boolean]
  --help         Show help                                             [boolean]
```
