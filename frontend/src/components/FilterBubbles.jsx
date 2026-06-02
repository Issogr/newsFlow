import { FilterBubble } from './FilterSurfaceControls';
import { SourceFilterList, TopicFilterList } from './FilterOptionLists';

const FilterBubbles = ({
  activeFilters,
  availableTopics,
  bubbleClassName,
  closedClassName,
  emptyLabel,
  locale,
  maxHeight,
  onToggleFilter,
  openBubble,
  visibleSources,
}) => (
  <>
    <FilterBubble
      open={openBubble === 'sources'}
      closedClassName={closedClassName}
      maxHeight={maxHeight}
      className={bubbleClassName}
    >
      {openBubble === 'sources' && (
        <SourceFilterList
          sources={visibleSources}
          activeSourceIds={activeFilters.sourceIds}
          emptyLabel={emptyLabel}
          onToggleSource={(sourceId) => onToggleFilter('sourceIds', sourceId)}
        />
      )}
    </FilterBubble>

    <FilterBubble
      open={openBubble === 'topics'}
      closedClassName={closedClassName}
      maxHeight={maxHeight}
      className={bubbleClassName}
    >
      {openBubble === 'topics' && (
        <TopicFilterList
          topics={availableTopics}
          activeTopics={activeFilters.topics}
          emptyLabel={emptyLabel}
          locale={locale}
          onToggleTopic={(topic) => onToggleFilter('topics', topic)}
        />
      )}
    </FilterBubble>
  </>
);

export default FilterBubbles;
