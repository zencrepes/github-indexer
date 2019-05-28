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
* [Installation](#installation)
* [Configuration](#configuration)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Introduction
<!-- introduction -->
This script has been created to easily export Data from GitHub and import it into an Elasticsearch instance. 

Whenever possible (i.e. issues, milestones, projects), it loads data sorted by the updated date in descending order (most recent first) and will stop as soon as it find the same node already in Elasticsearch. This way, first load takes some time, then you can just cron it to keep your Elasticsearch instance up to date. 

The overall logic is articulated around 3 stages:
 - Identify repositories to load data from (this is done through the ghRepos command => `github-indexer help ghRepos`) 
 - Select which repository to load data from by editing `~/.config/github-indexer/repositories.yml` and applying the changes by running `github-indexer cfRepos`
 - Load data from the selected repositories (for example `github-indexer ghIssues` to load issues)

<!-- introduction -->

# Installation
<!-- installation -->
```sh-session
git clone https://github.com/zencrepes/github-indexer.git
npm install -g github-indexer
```
<!-- installationstop -->

# Configuration
<!-- configuration -->
Configuration is stored in `~/.config/github-indexer/config.yml`, it contains the following settings;
```yaml
elasticsearch:
  port: 9200
  host: 'http://127.0.0.1'
fetch:
  max_nodes: 30
github:
  username: 'YOUR_USERNAME'
  token: 'TOKEN_HERE'
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
github-indexer/0.0.1 darwin-x64 node-v11.11.0
$ github-indexer --help [COMMAND]
USAGE
  $ github-indexer COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`github-indexer ghRepos [FLAGS]`](#github-indexer-ghRepos)
* [`github-indexer help [COMMAND]`](#github-indexer-help-command)

## `github-indexer ghRepos`

Grabs repositories and metadata from GitHub, a necessary step before being able to pull associated data such as Issues, Projects, PullRequests, ...

Three options are available to the user:
* Fetch repositories from organizations affiliated to the users' token
* Fetch repositories from a specified organization
* Fetch a single repository from a specified organization

At the end of the process, a YAML file is generated and stored at `~/.config/github-indexer/repositories.yml`, this file can then be edited to specify which repositories should be used to automatically fetch data

```
USAGE
  $ github-indexer ghRepos

OPTIONS
  -f, --force
  -g, --grab=affiliated|org|repo  (required) Select how to fetch repositories
  -h, --help                      show CLI help
  -o, --org=org                   GitHub organization login
  -r, --repo=repo                 GitHub repository name

EXAMPLES
  $ github-indexer ghRepos -g affiliated
  $ github-indexer ghRepos -g org -o jetbrains
  $ github-indexer ghRepos -g repo -o microsoft -r vscode
```
<!-- commandsstop -->
