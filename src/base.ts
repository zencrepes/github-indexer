import Command, {flags} from '@oclif/command'
import * as fs from 'fs'
import * as fse from 'fs-extra'
import * as jsYaml from 'js-yaml'
import * as path from 'path'

export default abstract class extends Command {
  static flags = {
    esnode: flags.string({
      required: false,
      env: 'ES_NODE',
      description: 'Elasticsearch node (for example: https://username:password@localhost:9200)'
    }),
    esca: flags.string({
      required: false,
      env: 'ES_CA',
      description: 'Path to the ES CA public key (for example: ./cacert.pem)'
    }),
    escloudid: flags.string({
      required: false,
      env: 'ES_CLOUD_ID',
      description: 'Elastic cloud id'
    }),
    escloudusername: flags.string({
      required: false,
      env: 'ES_CLOUD_USERNAME',
      description: 'Elastic cloud username'
    }),
    escloudpassword: flags.string({
      required: false,
      env: 'ES_CLOUD_PASSWORD',
      description: 'Elastic cloud password'
    }),
    esrepo: flags.string({
      required: false,
      env: 'ES_REPO',
      description: 'Elastic index containing the GitHub repository'
    }),
    glogin: flags.string({
      required: false,
      env: 'GITHUB_LOGIN',
      description: 'GitHub user Login (for fetching user repos)'
    }),
    gtoken: flags.string({
      required: false,
      env: 'GITHUB_TOKEN',
      description: 'GitHub user Token'
    }),
    gincrement: flags.string({
      required: false,
      env: 'GITHUB_INCREMENT',
      // tslint:disable-next-line:no-http-string
      description: 'GitHub API query increment (max nodes to fetch at a time)'
    }),
  }

  async init() {
    // If config file does not exists, initialize it:
    fse.ensureDirSync(this.config.configDir)
    fse.ensureDirSync(this.config.configDir + '/cache/')
    if (!fs.existsSync(path.join(this.config.configDir, 'config.yml'))) {
      const defaultConfig = {
        elasticsearch: {
          // tslint:disable-next-line:no-http-string
          node: 'http://127.0.0.1:9200',
          sslca: null,
          cloud: {
            id: null,
            username: null,
            password: null,
          },
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
          token: 'TOKEN_HERE',
          login: 'YOUR_USERNAME'
        }
      }
      fs.writeFileSync(path.join(this.config.configDir, 'config.yml'), jsYaml.safeDump(defaultConfig))
      this.log('Initialized configuration file with defaults in: ' + path.join(this.config.configDir, 'config.yml'))
    } else {
      this.log('Configuration file exists: ' + path.join(this.config.configDir, 'config.yml'))
    }
  }
}
