# ncu-config

Configure variables for node-core-utils to use. Global variables are stored
in `~/.ncurc` while local variables are stored in `$PWD/.ncu/config`.

```
ncu-config <command>

Commands:
  ncu-config set <key> <value>  Set a config variable
  ncu-config get <key>          Get a config variable
  ncu-config list               List the configurations

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
  --global                                            [boolean] [default: false]
```
