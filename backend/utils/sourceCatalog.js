const configuredSources = require('../config/newsSources');
const { getProviderIconUrl } = require('./sourceIcons');

const MULTI_LEVEL_PUBLIC_SUFFIX_MARKERS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

function extractHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isIpv4Address(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function extractRegistrableDomain(url) {
  const hostname = extractHostname(url);

  if (!hostname || hostname === 'localhost' || isIpv4Address(hostname)) {
    return hostname;
  }

  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return hostname;
  }

  const topLevelDomain = parts[parts.length - 1];
  const secondLevelDomain = parts[parts.length - 2];
  const hasCompoundPublicSuffix = topLevelDomain.length === 2
    && MULTI_LEVEL_PUBLIC_SUFFIX_MARKERS.has(secondLevelDomain)
    && parts.length >= 3;

  if (hasCompoundPublicSuffix) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

function deriveCommonName(names = []) {
  const normalizedNames = names.filter(Boolean);

  if (normalizedNames.length === 0) {
    return '';
  }

  if (normalizedNames.length === 1) {
    return normalizedNames[0];
  }

  let commonPrefix = normalizedNames[0];

  normalizedNames.slice(1).forEach((name) => {
    let nextLength = 0;
    while (nextLength < commonPrefix.length && nextLength < name.length && commonPrefix[nextLength] === name[nextLength]) {
      nextLength += 1;
    }
    commonPrefix = commonPrefix.slice(0, nextLength);
  });

  return commonPrefix
    .replace(/[\s\-:|/]+$/g, '')
    .trim();
}

function formatDomainLabel(domain = '') {
  const stem = String(domain || '').split('.')[0] || domain;
  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();
}

function deriveGroupName(sources = [], domain = '') {
  const commonName = deriveCommonName(sources.map((source) => source.name));
  if (commonName.length >= 3) {
    return commonName;
  }

  return formatDomainLabel(domain) || sources[0]?.name || domain;
}

function deriveSubSourceLabel(source, groupName, memberCount) {
  if (source.subSource) {
    return source.subSource;
  }

  if (memberCount <= 1) {
    return source.name;
  }

  const escapedGroupName = groupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const remainder = source.name
    .replace(new RegExp(`^${escapedGroupName}(?:\\s*[-:|/]\\s*|\\s+)*`, 'i'), '')
    .trim();

  return remainder || source.name;
}

function buildDomainSourceGroups(sources = [], options = {}) {
  const {
    includeLegacyIds = false
  } = options;

  const groupedSources = sources.reduce((groups, source) => {
    const registrableDomain = extractRegistrableDomain(source.url) || source.id;
    const group = groups.get(registrableDomain) || {
      id: registrableDomain,
      domain: registrableDomain,
      sources: []
    };

    group.sources.push(source);
    groups.set(registrableDomain, group);
    return groups;
  }, new Map());

  return new Map(
    [...groupedSources.entries()].map(([groupId, group]) => {
      const groupName = deriveGroupName(group.sources, group.domain);
      const language = group.sources[0]?.language || null;
      const legacyIds = includeLegacyIds ? new Set(group.sources.map((source) => source.groupId).filter(Boolean)) : new Set();

      return [groupId, {
        id: groupId,
        name: groupName,
        language,
        domain: group.domain,
        iconUrl: group.sources.find((source) => source.iconUrl)?.iconUrl || getProviderIconUrl(group.domain),
        subSources: group.sources.map((source) => ({
          id: source.id,
          name: source.name,
          label: deriveSubSourceLabel(source, groupName, group.sources.length),
          language: source.language || null,
          iconUrl: source.iconUrl || getProviderIconUrl(source.url || group.domain)
        })),
        memberIds: new Set(group.sources.map((source) => source.id)),
        memberNames: new Set(group.sources.map((source) => source.name)),
        legacyIds
      }];
    })
  );
}

const configuredSourceGroups = buildDomainSourceGroups(configuredSources, { includeLegacyIds: true });

const configuredSourceById = new Map(configuredSources.map((source) => [source.id, source]));
const configuredSourceByName = new Map(configuredSources.map((source) => [source.name, source]));
const groupIdAliasMap = new Map();

configuredSourceGroups.forEach((group) => {
  groupIdAliasMap.set(group.id, group.id);
  group.legacyIds.forEach((alias) => {
    groupIdAliasMap.set(alias, group.id);
  });
  group.memberIds.forEach((memberId) => {
    groupIdAliasMap.set(memberId, group.id);
  });
});

function getConfiguredSourceGroups() {
  return [...configuredSourceGroups.values()].map((group) => ({
    id: group.id,
    name: group.name,
    language: group.language,
    iconUrl: group.iconUrl || '',
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
    const groupId = groupIdAliasMap.get(configuredSource.id) || extractRegistrableDomain(configuredSource.url) || configuredSource.id;
    return configuredSourceGroups.get(groupId) || null;
  }

  const directGroupId = groupIdAliasMap.get(sourceId) || sourceId;
  return configuredSourceGroups.get(directGroupId) || null;
}

function getCanonicalSourceId(sourceId, sourceName) {
  return resolveConfiguredSourceGroup(sourceId, sourceName)?.id || sourceId;
}

function getCanonicalSourceName(sourceId, sourceName) {
  return resolveConfiguredSourceGroup(sourceId, sourceName)?.name || sourceName;
}

function getSourceVariantLabel(sourceId, sourceName) {
  const sourceGroup = resolveConfiguredSourceGroup(sourceId, sourceName);
  const configuredSource = resolveConfiguredSource(sourceId, sourceName);

  if (!sourceGroup || !configuredSource || sourceGroup.subSources.length <= 1) {
    return null;
  }

  return sourceGroup.subSources.find((subSource) => subSource.id === configuredSource.id)?.label || null;
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
    ids: [...new Set([sourceGroup.id, ...sourceGroup.legacyIds, ...sourceGroup.memberIds])],
    names: [...new Set([sourceGroup.name, ...sourceGroup.memberNames])]
  };
}

function getRawConfiguredSourceIds() {
  return new Set(configuredSources.map((source) => source.id));
}

function getConfiguredSourceGroupIds() {
  return new Set(configuredSourceGroups.keys());
}

function getLegacyConfiguredSourceGroupIds() {
  return new Set(
    [...configuredSourceGroups.values()].flatMap((group) => [...group.legacyIds])
  );
}

module.exports = {
  buildDomainSourceGroups,
  extractRegistrableDomain,
  getConfiguredSourceGroups,
  getCanonicalSourceId,
  getCanonicalSourceName,
  getSourceVariantLabel,
  getSourceAliases,
  getRawConfiguredSourceIds,
  getConfiguredSourceGroupIds,
  getLegacyConfiguredSourceGroupIds,
  getGroupedConfiguredSourceIds
};
