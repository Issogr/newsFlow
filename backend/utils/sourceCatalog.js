const configuredSources = require('../config/newsSources');

const configuredSourceById = new Map(configuredSources.map((source) => [source.id, source]));
const configuredSourceByName = new Map(configuredSources.map((source) => [source.name, source]));

const configuredSourceGroups = configuredSources.reduce((groups, source) => {
  const groupId = source.groupId || source.id;
  const existingGroup = groups.get(groupId) || {
    id: groupId,
    name: source.groupName || source.name,
    language: source.language || null,
    subSources: [],
    memberIds: new Set(),
    memberNames: new Set()
  };

  existingGroup.memberIds.add(source.id);
  existingGroup.memberNames.add(source.name);
  existingGroup.subSources.push({
    id: source.id,
    name: source.name,
    label: source.subSource || source.name,
    language: source.language || null
  });
  groups.set(groupId, existingGroup);
  return groups;
}, new Map());

function getConfiguredSourceGroups() {
  return [...configuredSourceGroups.values()].map((group) => ({
    id: group.id,
    name: group.name,
    language: group.language,
    subSources: group.subSources.map((subSource) => ({ ...subSource }))
  }));
}

function getGroupedConfiguredSourceIds() {
  return new Set(
    [...configuredSourceGroups.values()]
      .filter((group) => group.subSources.length > 1)
      .flatMap((group) => group.subSources.map((subSource) => subSource.id))
  );
}

function resolveConfiguredSource(sourceId, sourceName) {
  return configuredSourceById.get(sourceId)
    || configuredSourceByName.get(sourceName)
    || null;
}

function resolveConfiguredSourceGroup(sourceId, sourceName) {
  const configuredSource = resolveConfiguredSource(sourceId, sourceName);
  if (configuredSource) {
    return configuredSourceGroups.get(configuredSource.groupId || configuredSource.id) || null;
  }

  return configuredSourceGroups.get(sourceId) || null;
}

function getCanonicalSourceId(sourceId, sourceName) {
  return resolveConfiguredSourceGroup(sourceId, sourceName)?.id || sourceId;
}

function getCanonicalSourceName(sourceId, sourceName) {
  return resolveConfiguredSourceGroup(sourceId, sourceName)?.name || sourceName;
}

function getSourceVariantLabel(sourceId, sourceName) {
  const configuredSource = resolveConfiguredSource(sourceId, sourceName);

  if (!configuredSource) {
    return null;
  }

  return configuredSource.subSource || null;
}

function getSourceAliases(sourceId, sourceName) {
  const sourceGroup = resolveConfiguredSourceGroup(sourceId, sourceName);

  if (!sourceGroup) {
    return {
      ids: [sourceId].filter(Boolean),
      names: [sourceName].filter(Boolean)
    };
  }

  return {
    ids: [...new Set([sourceGroup.id, ...sourceGroup.memberIds])],
    names: [...new Set([sourceGroup.name, ...sourceGroup.memberNames])]
  };
}

function getRawConfiguredSourceIds() {
  return new Set(configuredSources.map((source) => source.id));
}

function getConfiguredSourceGroupIds() {
  return new Set(configuredSourceGroups.keys());
}

module.exports = {
  getConfiguredSourceGroups,
  getCanonicalSourceId,
  getCanonicalSourceName,
  getSourceVariantLabel,
  getSourceAliases,
  getRawConfiguredSourceIds,
  getConfiguredSourceGroupIds,
  getGroupedConfiguredSourceIds
};
