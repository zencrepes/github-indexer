const yaml = `
#https://www.elastic.co/guide/en/elasticsearch/plugins/current/mapper-size-usage.html
_source:
  enabled: true
properties:
  # Core properties of the entity
  id:
    type: keyword
  createdAt:
    type: date
  updatedAt:
    type: date
  closedAt:
    type: date
  title:
    type: text
  description:
    type: text
  url:
    type: keyword
  dueOn:
    type: date
  number:
    type: integer
  state:
    type: keyword
  issues:
    properties:
      totalCount:
        type: integer
  pullRequests:
    properties:
      totalCount:
        type: integer
`
export default yaml
