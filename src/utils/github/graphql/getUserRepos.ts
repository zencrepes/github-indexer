const query = `
  query ($repo_cursor: String, $increment: Int, $login: String!){
    rateLimit {
      limit
      cost
      remaining
      resetAt
    }
    user(login: $login){
      name
      login
      id
      url
      repositories {
        totalCount
      }
    }
    viewer {
      repositories(first: $increment, after: $repo_cursor) {
        totalCount
        edges {
          cursor
          node {
            name
            url
            id
            databaseId
            diskUsage
            forkCount
            isPrivate
            isArchived
            issues(first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) {
              totalCount
              edges {
                node {
                  id
                  updatedAt
                }
              }
            }
            labels(first: 1) {
              totalCount
            }
            milestones(first: 1) {
              totalCount
            }
            pullRequests(first: 1) {
              totalCount
            }
            releases(first: 1) {
              totalCount
            }
            projects(first: 1) {
              totalCount
            }
          }
        }
      }
    }
  }
`
export default query
