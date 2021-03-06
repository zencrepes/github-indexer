const query = `
  query ($org_name: String!, $repo_name: String!){
    rateLimit {
      limit
      cost
      remaining
      resetAt
    }
    repository(owner:$org_name, name:$repo_name) {
      name
      url
      id
      databaseId
      diskUsage
      forkCount
      isPrivate
      isArchived
      owner{
        id
        login
        url
      }
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
`
export default query
