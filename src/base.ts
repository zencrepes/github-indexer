import Command, {flags} from '@oclif/command'
import * as fs from 'fs'
import * as jsYaml from 'js-yaml'
import * as path from 'path'

export default abstract class extends Command {
  static flags = {
    loglevel: flags.string({options: ['error', 'warn', 'info', 'debug']})
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
          username: 'YOUR_USERNAME',
          token: 'TOKEN_HERE'
        }
      }
      fs.writeFileSync(path.join(this.config.configDir, 'config.yml'), jsYaml.safeDump(defaultConfig))
      this.log('Initialized configuration file in: ' + path.join(this.config.configDir, 'config.yml'))
    } else {
      this.log('Configuration file exists: ' + path.join(this.config.configDir, 'config.yml'))
    }
  }
}
