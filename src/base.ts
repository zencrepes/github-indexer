import Command, {flags} from '@oclif/command'
import * as fs from 'fs'
import * as jsYaml from 'js-yaml'
import * as path from 'path'

export default abstract class extends Command {
  static flags = {
    esport: flags.string({
      required: false,
      env: 'ES_PORT',
      description: 'Elastic search port'
    }),
    eshost: flags.string({
      required: false,
      env: 'ES_HOST',
      // tslint:disable-next-line:no-http-string
      description: 'Elastic search host'
    }),
    esrepo: flags.string({
      required: false,
      env: 'ES_REPO',
      // tslint:disable-next-line:no-http-string
      description: 'Elastic index containing the GitHub repository'
    }),
    gtoken: flags.string({
      required: false,
      env: 'GITHUB_TOKEN',
      // tslint:disable-next-line:no-http-string
      description: 'GitHub user Token'
    }),
  }

  async init() {
    // If config file does not exists, initialize it:
    if (!fs.existsSync(path.join(this.config.configDir, 'config.yml'))) {
      const defaultConfig = {
        elasticsearch: {
          port: 9200,
          // tslint:disable-next-line:no-http-string
          host: 'http://127.0.0.1',
          indices: {
            repos: 'gh_repos',
            issues: 'gh_issues_',
            projects: 'gh_projects_',
            labels: 'gh_labels_',
            milestones: 'gh_milestones_',
            prs: 'gh_prs_',
          }
        },
        fetch: {
          max_nodes: 30
        },
        github: {
          token: 'TOKEN_HERE'
        }
      }
      fs.writeFileSync(path.join(this.config.configDir, 'config.yml'), jsYaml.safeDump(defaultConfig))
      this.log('Initialized configuration file with defaults in: ' + path.join(this.config.configDir, 'config.yml'))
    } else {
      this.log('Configuration file exists: ' + path.join(this.config.configDir, 'config.yml'))
    }
  }
}
