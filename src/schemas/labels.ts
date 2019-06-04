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
  name:
    type: text
  description:
    type: text
  url:
    type: keyword
  color:
    type: integer
  isDefault:
    type: boolean
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
