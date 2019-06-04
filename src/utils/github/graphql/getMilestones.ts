const query = `
  query ($repo_cursor: String, $increment: Int, $org_name: String!, $repo_name: String!){
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
      milestones(first: $increment, after: $repo_cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
        totalCount
        edges {
         cursor
          node {
            id
            createdAt
            updatedAt
            closedAt
            description
            dueOn
            issues (first: 1) {
              totalCount
            }
            pullRequests(first: 1) {
              totalCount
            }
            number
            state
            title
            url
          }
        }
      }
    }
  }
`
export default query
