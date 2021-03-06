const yaml = `
#https://www.elastic.co/guide/en/elasticsearch/plugins/current/mapper-size-usage.html
_source:
  enabled: true
properties:
  # This is not a GitHub field, it is used by the system to define which repositories should be grabbed
  active:
    type: boolean
  # Core properties of the entity
  id:
    type: keyword
  databaseId:
    type: integer
  diskUsage:
    type: integer
  forkCount:
    type: integer
  isArchived:
    type: boolean
  isPrivate:
    type: boolean
  name:
    type: text
    fields:
      raw:
        type: keyword
  url:
    type: keyword
  issues:
    properties:
      totalCount:
        type: integer
  labels:
    properties:
      totalCount:
        type: integer
  milestones:
    properties:
      totalCount:
        type: integer
  projects:
    properties:
      totalCount:
        type: integer
  pullRequests:
    properties:
      totalCount:
        type: integer
  releases:
    properties:
      totalCount:
        type: integer
  org:
    properties:
      id:
        type: keyword
      login:
        type: keyword
      name:
        type: text
        fields:
          raw:
            type: keyword
      url:
        type: keyword
  owner:
    properties:
      id:
        type: keyword
      login:
        type: keyword
      url:
            type: keyword
`
export default yaml
