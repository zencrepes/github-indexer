github-indexer
==============

Grabs data from GitHub and pushes it to an Elasticsearch instance

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/github-indexer.svg)](https://npmjs.org/package/github-indexer)
[![CircleCI](https://circleci.com/gh/zencrepes/github-indexer/tree/master.svg?style=shield)](https://circleci.com/gh/zencrepes/github-indexer/tree/master)
[![Downloads/week](https://img.shields.io/npm/dw/github-indexer.svg)](https://npmjs.org/package/github-indexer)
[![License](https://img.shields.io/npm/l/github-indexer.svg)](https://github.com/zencrepes/github-indexer/blob/master/package.json)

<!-- toc -->
* [Introduction](#introduction)
* [Quick start with Docker](#quick-start-with-docker)
* [Local installation](#local-installation)
* [Configuration](#configuration)
* [Usage](#usage)
* [Commands](#commands)
* [Develop](#develop)
* [Build and publish](#build-and-publish)
<!-- tocstop -->

# Introduction
<!-- introduction -->
This script has been created to easily export Data from GitHub and import it into an Elasticsearch instance. 

Whenever possible (i.e. issues, milestones, projects), it loads data sorted by the updated date in descending order (most recent first) and will stop as soon as it find the same node already in Elasticsearch. This way, first load takes some time, then you can just cron it to keep your Elasticsearch instance up to date. 

The overall logic is articulated around 3 stages:
 - Identify repositories to load data from
 - [OPTIONAL] Select which repository to load data from by editing `~/.config/github-indexer/repositories.yml` and applying the changes by running `github-indexer cfRepos`
    - _or force repos to be active during initial fetch by running ghRepos with the -f flag:_ `github-indexer ghRepos YOUR_OPTIONS -f`
 - Load data from the selected repositories (for example `github-indexer ghIssues` to load issues)

You can then re-run the scripts at regular interval to fetch the updated nodes.

Note: GitHub doesn't provide a mechanism to fetch new or updated labels so the script will (flush the index and)load all labels every time `ghLabels` is executed.

<!-- introduction -->

# Quick start with Docker

You can use github-indexer docker image to get started quickly.

For example, to pull all repositories from an org:

Fetch the latest image
```sh-session
docker pull zencrepes/github-indexer:latest
```

Run
```sh-session
docker run -it --rm \
-e ES_NODE='https://username:password@host.docker.internal:9200' \
-e GITHUB_TOKEN='YOUR TOKEN HERE' \
zencrepes/github-indexer:latest github-indexer ghRepos -g org -o YOUR_ORG -f
```

Or in a shell (you can then use github-indexer commands)
```sh-session
docker run -it --rm \
-e ES_NODE='https://username:password@host.docker.internal:9200' \
-e GITHUB_TOKEN='YOUR TOKEN HERE' \
zencrepes/github-indexer:latest /bin/ash
```


# Local installation
<!-- installation -->

You can choose to install github-indexer locally, although running docker is probably easier if you're just looking at using github-indexer.
```sh-session
npm install -g github-indexer
```
<!-- installationstop -->


# Configuration
<!-- configuration -->
A configuration file with default settings is automatically generated in `~/.config/github-indexer/config.yml` the first time you run the indexer. 

Environment variable are also available for some of the configuration settings:
 - ES_NODE: Elasticsearch node (for example: https://username:password@localhost:9200)
 - ES_CA: Path to the ES CA public key (for example: ./cacert.pem)
 - ES_CLOUD_ID: Elastic cloud id
 - ES_CLOUD_USERNAME: Elastic cloud id
 - ES_CLOUD_PASSWORD: Elastic cloud password
 - ES_REPO: Elasticsearch index containing the repository configuration
 - GITHUB_TOKEN: GitHub token for fetching data.
 - GITHUB_LOGIN: GitHub user login to fatch data from (for affiliated mode)
 - GITHUB_INCREMENT: Number of nodes to fetch at a time (max 100)

Environment variable will take precedence over the corresponding settings in the configuration file.

Authentication to the Elasticsearch cluster is possible either through Basic Auth (using ES_NODE only), with SSL (using ES_NODE and ES_CA), or to an Elastic Cloud cluster (using ES_CLOUD_ID, ES_CLOUD_USERNAME and ES_CLOUD_PASSWORD).

Configuration is stored in `~/.config/github-indexer/config.yml`, it contains the following settings;
```yaml
elasticsearch:
  node: 'https://username:password@host.docker.internal:9200' # Eleasticsearch node
  sslca: './cacert.pem'             # Path the the public CA cert, or null
  cloud:                            # Elastic Cloud credentials
    id: null
    username: null
    password: null
  indices:
    repos: 'gh_repos'               # Eleasticsearch index containing repository configuration
    issues: 'gh_issues_'            # Prefix for the Elasticsearch index containing issues, one index is created per repository, eg: gh_issues_ORG_REPO
    projects: 'gh_projects_'        # Prefix for the Elasticsearch index containing projects, one index is created for org-level project and one per repository, eg: gh_projects_ORG_REPO
    labels: 'gh_labels_'            # Prefix for the Elasticsearch index containing labels, one index is created per repository, eg: gh_labels_ORG_REPO
    milestones: 'gh_milestones_'    # Prefix for the Elasticsearch index containing milestones, one index is created per repository, eg: gh_milestones_ORG_REPO
    prs: 'gh_prs_'                  # Prefix for the Elasticsearch index containing pull requests, one index is created per repository, eg: gh_prs_ORG_REPO
fetch:
  max_nodes: 30                     # Number of nodes to request from GitHub Graphql API (max: 100), avoid using too high of a number of large repositories
github:
  token: 'TOKEN_HERE'               # GitHub authorization token
  login: 'YOUR_USERNAME'               # GitHub authorization token
```

All of the configuration settings should be self-explanatory with the exception of `max_nodes`, which is used to indicate how many root nodes should be fetched from GitHub graphql's API. The maximum number supported by GitHub is 100, but please note that GitHub's GraphQL API can be unstable with large repositories, it is recommended to keep that number around 30 -> 50. A smaller number triggers more smaller call, a larger number triggers less larger calls.

You also need to obtain a GitHub Token, to do so, simply visit: https://github.com/settings/tokens and generate a `personal access token`. You'll need the following scope: ` public_repo, read:org, user`

<p align="center">
  <img alt="Generate GitHub Token" title="Github Token scope" src="./docs/github-tokens.png" width="640" />
</p>

Then you simply have to replace `TOKEN_HERE` with the token you just generated.

<!-- configurationstop -->

# Usage
<!-- usage -->
```sh-session
$ npm install -g github-indexer
$ github-indexer COMMAND
running command...
$ github-indexer (-v|--version|version)
github-indexer/1.0.0 darwin-x64 node-v10.16.0
$ github-indexer --help [COMMAND]
USAGE
  $ github-indexer COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`github-indexer cfRepos`](#github-indexer-cfrepos)
* [`github-indexer ghIssues`](#github-indexer-ghissues)
* [`github-indexer ghLabels`](#github-indexer-ghlabels)
* [`github-indexer ghMilestones`](#github-indexer-ghmilestones)
* [`github-indexer ghProjects`](#github-indexer-ghprojects)
* [`github-indexer ghPullrequests`](#github-indexer-ghpullrequests)
* [`github-indexer ghRepos`](#github-indexer-ghrepos)
* [`github-indexer help [COMMAND]`](#github-indexer-help-command)
* [`github-indexer init`](#github-indexer-init)

## `github-indexer cfRepos`

Enable/disable repositories by reading the configuration file

```
USAGE
  $ github-indexer cfRepos

OPTIONS
  -h, --help                         show CLI help
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLE
  $ github-indexer cfRepo
```

_See code: [src/commands/cfRepos.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/cfRepos.ts)_

## `github-indexer ghIssues`

Fetch issues from GitHub

```
USAGE
  $ github-indexer ghIssues

OPTIONS
  -h, --help                         show CLI help
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLE
  $ github-indexer ghIssues
```

_See code: [src/commands/ghIssues.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/ghIssues.ts)_

## `github-indexer ghLabels`

Fetch labels from GitHub

```
USAGE
  $ github-indexer ghLabels

OPTIONS
  -h, --help                         show CLI help
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLE
  $ github-indexer ghLabels
```

_See code: [src/commands/ghLabels.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/ghLabels.ts)_

## `github-indexer ghMilestones`

Fetch milestones from GitHub

```
USAGE
  $ github-indexer ghMilestones

OPTIONS
  -h, --help                         show CLI help
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLE
  $ github-indexer ghMilestones
```

_See code: [src/commands/ghMilestones.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/ghMilestones.ts)_

## `github-indexer ghProjects`

Fetch projects from GitHub

```
USAGE
  $ github-indexer ghProjects

OPTIONS
  -h, --help                         show CLI help
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLE
  $ github-indexer ghIssues
```

_See code: [src/commands/ghProjects.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/ghProjects.ts)_

## `github-indexer ghPullrequests`

Fetch Pull Requests (PRs) from GitHub

```
USAGE
  $ github-indexer ghPullrequests

OPTIONS
  -h, --help                         show CLI help
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLE
  $ github-indexer ghPullrequests
```

_See code: [src/commands/ghPullrequests.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/ghPullrequests.ts)_

## `github-indexer ghRepos`

Fetch repositories from GitHub (FIRST STEP, start HERE)

```
USAGE
  $ github-indexer ghRepos

OPTIONS
  -f, --force                        Make all fetched repositories active by default
  -g, --grab=affiliated|org|repo     (required) Select how to fetch repositories
  -h, --help                         show CLI help
  -o, --org=org                      GitHub organization login
  -r, --repo=repo                    GitHub repository name
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLES
  $ github-indexer ghRepo -g affiliated
  $ github-indexer ghRepo -g org -o jetbrains
  $ github-indexer ghRepo -g repo -o microsoft -r vscode
```

_See code: [src/commands/ghRepos.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/ghRepos.ts)_

## `github-indexer help [COMMAND]`

display help for github-indexer

```
USAGE
  $ github-indexer help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v2.1.6/src/commands/help.ts)_

## `github-indexer init`

Initialize the configuration file

```
USAGE
  $ github-indexer init

OPTIONS
  --esca=esca                        Path to the ES CA public key (for example: ./cacert.pem)
  --escloudid=escloudid              Elastic cloud id
  --escloudpassword=escloudpassword  Elastic cloud password
  --escloudusername=escloudusername  Elastic cloud username
  --esnode=esnode                    Elasticsearch node (for example: https://username:password@localhost:9200)
  --esrepo=esrepo                    Elastic index containing the GitHub repository
  --gincrement=gincrement            GitHub API query increment (max nodes to fetch at a time)
  --glogin=glogin                    GitHub user Login (for fetching user repos)
  --gtoken=gtoken                    GitHub user Token

EXAMPLE
  $ github-indexer init
```

_See code: [src/commands/init.ts](https://github.com/zencrepes/github-indexer/blob/v1.0.0/src/commands/init.ts)_
<!-- commandsstop -->

# Develop
```sh-session
git clone https://github.com/zencrepes/github-indexer.git
npm install 
```

# Build and publish
```sh-session
tsc -b
npm publish
```
