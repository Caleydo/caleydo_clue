/**
 * Created by Holger Stitz on 01.06.2017.
 */
import * as d3 from 'd3';
import { AVisInstance, AppContext, BaseUtils, setProperty, PropertyType, ProvenanceGraphDim, SelectOperation, SelectionUtils } from 'phovea_core';
import { Select2 } from './Select2';
import { Query, SearchResultSequence, VisStateIndex, } from './VisStateIndex';
import { PropertyModifier } from './PropertyModifier';
import { ThumbnailUtils } from '../base';
import { ClueSidePanelEvents } from '../wrapper';
/**
 * To enable the Provenance Retrieval Panel the application must set to the ACLUEWrapper.
 *
 * ```
 * const elems = template.create(document.body, { ... });
 * elems.graph.then((graph) => {
 *   const app = gapminder.create(<Element>elems.$main.node(), graph);
 *   elems.setApplication(app); // set application to enable provenance retrieval
 *   // ...
 * });
 * ```
 */
export class ProvRetrievalPanel extends AVisInstance {
    constructor(data, parent, options) {
        super();
        this.data = data;
        this.parent = parent;
        this.options = options;
        this.defaultOptions = {
            captureNonPersistedStates: ProvRetrievalPanel.CAPTURE_AND_INDEX_NON_PERSISTED_STATES,
            rotate: 0,
            app: null,
            startCollapsed: false
        };
        this.executedFirstListener = ((evt, action, state) => {
            const promise = this.captureAndIndexState(state)
                .then((success) => {
                if (success) {
                    this.updateWeightingEditor(this.query);
                    this.performSearch(this.query);
                }
                return success;
            })
                .catch((error) => {
                console.error(`Error while indexing state ${state.name} (#${state.id}).`, error);
                return false;
            });
            // store promise for switchState listener
            this.executedFirstPromises.set(state, promise);
        });
        this.searchForStateListener = ((evt, state) => {
            this.propertyModifier.searchForStateProperty = (state) ? setProperty(`Search for State '${state.name}'`, state.visState.propValues) : null;
            this.$select2Instance.updateData(this.propertyModifier.properties);
            if (state) {
                this.$select2Instance.open();
            }
            else {
                this.$select2Instance.close();
            }
            // add properties directly instead of new property to select2
            //this.query = this.query.replacePropValues(state.visState.propValues);
            //this.updateWeightingEditor(this.query);
            //this.performSearch(this.query);
        });
        this.switchStateListener = ((evt, state) => {
            // if the state is executed once wait until this has finished, otherwise switch directly
            const promise = (this.executedFirstPromises.has(state)) ? this.executedFirstPromises.get(state) : Promise.resolve(true);
            promise.then((success) => {
                if (success) {
                    this.propertyModifier.activeVisState = state.visState;
                    this.$select2Instance.updateData(this.propertyModifier.properties);
                    // update active search result
                    this.currentSequences
                        .forEach((seq) => {
                        seq.searchResults.forEach((d) => d.isActiveInMainView = (d.state.node === state));
                    });
                    this.updateResults(this.currentSequences, false);
                }
            });
        });
        this.$select2Instance = new Select2();
        this.dim = [200, 100];
        this.stateIndex = new VisStateIndex();
        this.lastStateBeforeSearch = null;
        this.query = new Query();
        this.currentSequences = [];
        this.propertyModifier = new PropertyModifier();
        this.executedFirstPromises = new Map();
        this.options = BaseUtils.mixin({}, this.defaultOptions, options);
        this.$node = this.build(d3.select(parent));
        AppContext.getInstance().onDOMNodeRemoved(this.node, this.destroy, this);
        this.bind();
        this.initStateIndex(this.data.states, this.options.captureNonPersistedStates);
    }
    bind() {
        this.data.on('search_for_state', this.searchForStateListener);
        this.data.on('executed_first', this.executedFirstListener);
        this.data.on('switch_state', this.switchStateListener);
    }
    destroy() {
        super.destroy();
        this.data.off('search_for_state', this.searchForStateListener);
        this.data.off('executed_first', this.executedFirstListener);
        this.data.off('switch_state', this.switchStateListener);
    }
    get rawSize() {
        return this.dim;
    }
    get node() {
        return this.$node.node();
    }
    setLastStateBeforeSearch() {
        if (this.lastStateBeforeSearch) {
            return;
        }
        this.lastStateBeforeSearch = this.data.act;
        this.$node.select('.btn-return-to-last-state').classed('hidden', false);
        this.$node.select('.return-to-last-state').classed('hidden', false)
            .select('.state-title').text(this.lastStateBeforeSearch.name);
    }
    resetLastStateBeforeSearch() {
        this.lastStateBeforeSearch = null;
        this.$node.select('.btn-return-to-last-state').classed('hidden', true);
        this.$node.select('.return-to-last-state').classed('hidden', true);
    }
    /**
     * Build the index of given StateNodes for later retrieval.
     * The flag determines how to handle states that do not contain a valid visState.
     *
     * @param stateNodes List of StateNodes that should be indexed
     * @param captureAndIndex Capture and index *non-persisted* states?
     */
    initStateIndex(stateNodes, captureAndIndex) {
        // already persisted states have to be added to the index only
        stateNodes
            .filter((stateNode) => stateNode.visState.isPersisted())
            .forEach((stateNode) => {
            //console.log('already persisted', stateNode.name, stateNode.visState.isPersisted());
            this.stateIndex.addState(stateNode.visState);
            this.propertyModifier.addState(stateNode.visState);
        });
        const nonPersistedStates = stateNodes.filter((stateNode) => !stateNode.visState.isPersisted());
        if (nonPersistedStates.length > 0) {
            if (captureAndIndex) {
                this.jumpToAndIndexStates(nonPersistedStates);
            }
            else if (nonPersistedStates.length > 1) { // message only if more than 1 state
                console.warn(`${nonPersistedStates.length} provenance states were not indexed for the provenance state search. You will get incomplete search results.`);
            }
        }
    }
    /**
     * Iterates asynchronously over all states, jumps to them, captures the visState and indexes them.
     * @param stateNodes
     * @returns {Promise<any>} Will be resolved, once all states are processed.
     */
    async jumpToAndIndexStates(stateNodes) {
        const currentState = this.data.act;
        for (const stateNode of stateNodes) {
            await this.data.jumpTo(stateNode);
            await this.captureAndIndexState(stateNode);
            //console.log('newly persisted', stateNode.name, stateNode.visState.terms);
        }
        return this.data.jumpTo(currentState); // jump back to previous state
    }
    /**
     * Captures the visState of a node and adds it to the index
     * @param stateNode
     * @returns {Promise<boolean>} Returns `true` if successfully added to index. Otherwise returns `false`.
     */
    async captureAndIndexState(stateNode) {
        if (stateNode.visState.isPersisted()) {
            return Promise.resolve(true);
        }
        const visState = await stateNode.visState.captureAndPersist();
        this.propertyModifier.properties = await this.options.app.getVisStateProps();
        this.propertyModifier.addState(visState);
        this.$select2Instance.updateData(this.propertyModifier.properties);
        return this.stateIndex.addState(visState);
    }
    build($parent) {
        const asideName = 'provenance-retrieval-panel';
        const $p = $parent.append('aside')
            //.classed('provenance-layout-vis', true)
            .classed('hidden', this.options.startCollapsed)
            .classed(asideName, true)
            .style('transform', 'rotate(' + this.options.rotate + 'deg)');
        $p.html(`
      <div class="header">
        <h2><i class="fas fa-search"></i> Search in Current Session
        <button type="button" class="close" aria-label="Close" title="Close search panel"><span aria-hidden="true">×</span></button>
        <a href="#" class="hidden btn-return-to-last-state" title="Return to the state you left off before this search"><i class="fas fa-step-backward"></i></a></h2>
      </div>
      <div class="body">
        <form class="search-form" action="#" onsubmit="return false; ">
          <div class="form-group">
            <label class="sr-only" for="prov-retrieval-select">Filter provenance states by &hellip;</label>
            <select multiple style="width: 100%" class="form-control hidden" id="prov-retrieval-select"></select>
            <div class="btn-group hidden">
              <a data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                <i class="fas fa-cog" aria-hidden="true"></i>
              </a>
              <ul class="dropdown-menu dropdown-menu-right">
                <li><span>Search term suggestions based on &hellip;</span></li>
                <li class="active"><a href="#" class="suggestion-filter-all">Whole history</a></li>
                <li class=""><a href="#" class="suggestion-filter-active"><span>Active session state only</span></a></li>
              </ul>
            </div>
          </div>
        </form>
        <div id="prov-retrieval-weighting-editor">
          <ul class="terms">
            <li class="remove-all" data-tooltip="Remove all">×</li>
          </ul>
          <ul class="weighting-editor"></ul>
          <div class="number-of-results"></div>
        </div>
      </div>
      <div class="body scrollable">
        <svg class="hidden">
          <defs>
            <g id="one-state">
              <circle r="10" cx="180" cy="20" stroke-width="0" style="fill: var(--active-state-first)" />
            </g>
            <g id="two-states">
              <line x1="100" y1="20" x2="180" y2="20" stroke-width="6" style="stroke: var(--stroke-color)" />
              <circle r="10" cx="100" cy="20" stroke-width="0" style="fill: var(--active-state-first)" />
              <circle r="10" cx="180" cy="20" stroke-width="0" style="fill: var(--active-state-last)"/>
            </g>
            <g id="three-states">
              <line x1="20" y1="20" x2="180" y2="20" stroke-width="6" style="stroke: var(--stroke-color)" />
              <circle r="10" cx="20" cy="20" stroke-width="0" style="fill: var(--active-state-first)" />
              <circle r="10" cx="100" cy="20" stroke-width="0" style="fill: var(--active-state-center)" />
              <circle r="10" cx="180" cy="20" stroke-width="0" style="fill: var(--active-state-last)" />
            </g>
            <g id="n-states">
              <line x1="20" y1="20" x2="60" y2="20" stroke-width="6" style="stroke: var(--stroke-color)" />
              <line x1="140" y1="20" x2="180" y2="20" stroke-width="6" style="stroke: var(--stroke-color)" />
              <circle r="10" cx="20" cy="20" stroke-width="0" style="fill: var(--active-state-first)" />
              <circle r="10" cx="180" cy="20" stroke-width="0" style="fill: var(--active-state-last)" />
            </g>
            <g id="loading-animation">
              <circle r="11" transform="translate(16 16)" class="a">
                <animateTransform attributeName="transform" type="scale" additive="sum" values="1;1.42;1;1;1;1;1;1;1;1" dur="1500ms" repeatCount="indefinite"/>
              </circle>
              <circle r="11" transform="translate(64 16)" class="a">
                <animateTransform attributeName="transform" type="scale" additive="sum" values="1;1;1;1;1.42;1;1;1;1;1" dur="1500ms" repeatCount="indefinite"/>
              </circle>
              <circle r="11" transform="translate(112 16)" class="a">
                <animateTransform attributeName="transform" type="scale" additive="sum" values="1;1;1;1;1;1;1;1.42;1;1" dur="1500ms" repeatCount="indefinite"/>
              </circle>
            </g>
          </defs>
        </svg>
        <ol class="search-results" start="1"></ol>
        <div>
          <div class="return-to-last-state hidden">
            <p>Do you want to return to the following state?
            <i class="state-title"></i>
            You have stopped the analysis at that state before the last search.</p>
            <p><a class="yes btn btn-default" href="#"><i class="fas fa-step-backward" aria-hidden="true"></i>
 Yes, please bring me back!</a></p>
            <p><a class="no" href="#">No, thanks. Hide this message.</a></p>
          </div>
          <p class="start-searching">Enter a search term to find similar views.</p>
        </div>
      </div>
    `);
        const $panelSelector = $parent.select('.panel-selector');
        $panelSelector.append(`a`)
            .attr('title', 'Open Search Panel')
            .classed('btn-search', true)
            .classed('hidden', !$p.classed('hidden'))
            .html(`<i class="fas fa-search"></i>`)
            .on('click', () => {
            $parent.select(`.${asideName}`).classed('hidden', false);
            $panelSelector.select('.btn-search').classed('hidden', true);
            this.fire(ClueSidePanelEvents.OPEN);
        });
        $p.select('.close')
            .on('click', () => {
            $parent.select(`.${asideName}`).classed('hidden', true);
            $panelSelector.select('.btn-search').classed('hidden', false);
            this.fire(ClueSidePanelEvents.CLOSE);
        });
        const filterSelect2SuggestionsListener = (showActiveStateOnly) => {
            d3.event.preventDefault();
            $p.selectAll('.dropdown-menu li').classed('active', false);
            d3.select(d3.event.srcElement.parentElement).classed('active', true);
            this.propertyModifier.showActiveStateOnly = showActiveStateOnly;
            this.$select2Instance.updateData(this.propertyModifier.properties);
            this.$select2Instance.open();
        };
        $p.select('.dropdown-menu a.suggestion-filter-all')
            .on('click', () => {
            filterSelect2SuggestionsListener(false);
        });
        $p.select('.dropdown-menu a.suggestion-filter-active')
            .on('click', () => {
            filterSelect2SuggestionsListener(true);
        });
        $p.select('.btn-return-to-last-state')
            .on('click', () => {
            d3.event.preventDefault();
            this.data.selectState(this.lastStateBeforeSearch, SelectionUtils.toSelectOperation(d3.event));
            this.data.jumpTo(this.lastStateBeforeSearch);
            this.resetLastStateBeforeSearch();
        });
        $p.select('.return-to-last-state .yes')
            .on('click', () => {
            d3.event.preventDefault();
            this.data.selectState(this.lastStateBeforeSearch, SelectionUtils.toSelectOperation(d3.event));
            this.data.jumpTo(this.lastStateBeforeSearch);
            this.resetLastStateBeforeSearch();
        });
        $p.select('.return-to-last-state .no')
            .on('click', () => {
            d3.event.preventDefault();
            this.resetLastStateBeforeSearch();
        });
        this.$searchResults = $p.select('.search-results');
        if (this.options.app && this.options.app.getVisStateProps) {
            this.options.app.getVisStateProps().then((properties) => {
                $p.select('.body > form .btn-group').classed('hidden', false);
                this.propertyModifier.properties = properties;
                const $select2 = this.$select2Instance.init('#prov-retrieval-select', this.propertyModifier.properties);
                $select2
                    .on('select2:select', (evt) => {
                    const propValue = evt.params.data.propValue;
                    propValue.isSelected = true;
                    //console.log('select2:select', evt.params.data);
                    this.query = this.query.addPropValue(propValue);
                    this.updateWeightingEditor(this.query);
                    this.performSearch(this.query);
                    // prevent adding new terms as tags and add them to the weighting editor instead
                    $select2.val(null).trigger('change');
                })
                    .on('select2:unselect', (evt) => {
                    const propValue = evt.params.data.propValue;
                    propValue.isSelected = false;
                    //console.log('select2:unselect ', evt.params.data);
                    this.query = this.query.removePropValue(propValue);
                    this.updateWeightingEditor(this.query);
                    this.performSearch(this.query);
                    // close drop down on unselect (see https://github.com/select2/select2/issues/3209#issuecomment-149663474)
                    if (!evt.params.originalEvent) {
                        return;
                    }
                    evt.params.originalEvent.stopPropagation();
                });
            });
        }
        else {
            $p.select('.body > form').classed('hidden', true);
        }
        return $p;
    }
    updateWeightingEditor(query) {
        const $ul = d3.select('#prov-retrieval-weighting-editor ul.terms');
        const $terms = $ul.selectAll('li.term')
            .data(query.propValues, (d) => String(d.id));
        $terms.enter().insert('li', 'li.remove-all').classed('term', true);
        $terms
            .style('border-color', (d, i) => query.colors[i])
            .style('color', (d, i) => query.colors[i])
            .html((d, i) => `
        <span class="remove" role="presentation" title="Remove">×</span>
        <span>${d.text}</span>
      `) //;
            //$terms.select('.remove')
            .on('click', (propValue) => {
            propValue.isSelected = false;
            this.query = this.query.removePropValue(propValue);
            this.updateWeightingEditor(this.query);
            this.performSearch(this.query);
        });
        $terms.exit().remove();
        $ul.select('li.remove-all')
            .on('click', () => {
            this.query = this.query.clear();
            this.updateWeightingEditor(this.query);
            this.performSearch(this.query);
        });
        const $weightingEditor = d3.select('#prov-retrieval-weighting-editor .weighting-editor');
        const widthScale = d3.scale.linear().domain([0, 1]).range([0, $weightingEditor.node().clientWidth]);
        const $editorLi = $weightingEditor.selectAll('li')
            .data(query.propValues, (d) => String(d.id));
        $editorLi.enter().append('li');
        $editorLi
            .style('width', (d, i) => `${widthScale(query.weights[i])}px`)
            .style('background-color', (d, i) => query.colors[i])
            .attr('title', (d, i) => `${d.text}: ${d3.round(query.weights[i] * 100, 2)}%`)
            .html((d, i) => `<span class="draggable"></span>`);
        const drag = d3.behavior.drag()
            .on('drag', (d, i) => {
            const newWeight = widthScale.invert(d3.event.x); // px to %
            const diffWeight = (query.weights[i] - newWeight) / (query.weights.length - 1 - i);
            query.weights = query.weights.map((d, j) => {
                if (i === j) {
                    return newWeight; // apply new weight to current element
                }
                else if (j > i) {
                    return d + diffWeight; // shift all upcoming elements
                }
                return d; // keep previous elements the same
            });
            $editorLi
                .attr('title', (d, j) => `${d.text}: ${d3.round(query.weights[j] * 100, 2)}%`)
                .style('width', (d, j) => `${widthScale(query.weights[j])}px`);
        })
            .on('dragend', () => {
            this.currentSequences.forEach((seq) => seq.update());
            this.updateResults(this.currentSequences, false);
            const searchResults = this.currentSequences
                .map((d) => d.searchResults)
                .reduce((prev, curr) => prev.concat(curr), []); // flatten the array
            this.data.fire('search_modified_weights', searchResults);
        });
        $editorLi.select('.draggable').call(drag);
        $editorLi.exit().remove();
    }
    performSearch(query) {
        if (!query) {
            return;
        }
        // create a similarity scale for all categorical property values
        const categoricalScale = this.createCategoricalSimilarityScale(query);
        const similarityScale = (type, value) => {
            if (type === PropertyType.CATEGORICAL) {
                return categoricalScale(value);
            }
            return value; // all other property types without scaling
        };
        const results = this.stateIndex
            .compareAll(query, similarityScale)
            .filter((state) => state.similarity > 0); // filter results that does not match at all
        if (results.length > 0) {
            this.$node.select('.number-of-results').html(`<b>${results.length}</b> Provenance States found`);
            this.data.fire('search_complete', results);
        }
        else {
            this.$node.select('.number-of-results').html('');
            this.data.fire('search_clear');
        }
        // update select2 properties
        this.propertyModifier.searchResults = results;
        this.$select2Instance.updateData(this.propertyModifier.properties);
        this.currentSequences = this.groupIntoSequences(results);
        this.updateResults(this.currentSequences, true);
    }
    /**
     * Filter the query for all categorical properties.
     * Run a comparison and create a D3 scale with the domain
     * between 0 and the maximum TF-IDF value.
     *
     * Background: The TF-IDF value can go beyond 1. A high TF-IDF value
     * can be reached by a high term frequency (in the given visualization state)
     * and a low document frequency of the term in the whole collection
     * of visualization states.
     * We must ensure TF-IDF values in the range [0, 1] in order to work
     * that the weighted scaling is still working.
     *
     * @param {IQuery} query
     * @returns {d3.scale.Linear<number, number>}
     */
    createCategoricalSimilarityScale(query) {
        const categoricalQuery = new Query()
            .replacePropValues(query.propValues.filter((d) => d.type === PropertyType.CATEGORICAL));
        const similarities = this.stateIndex
            .compareAll(categoricalQuery) // no second parameter = without scaling
            .filter((state) => state.similarity > 0)
            .map((result) => result.similarities)
            .reduce((prev, curr) => prev.concat(curr), []); // flatten the array
        return d3.scale.linear().domain([0, Math.max(1, ...similarities)]).range([0, 1]);
    }
    /**
     * Given a list of search results cluster the results into sequences
     * A sequence is a subset (list) of consecutive states.
     * Note that every search result can only be sorted into one sequence (no duplicate states).
     *
     * Sequence Algorithm:
     * 1. Partition search results by the number of matching terms (1, 2, 3, ...)
     * 2. Within each group: Run through all search results.
     *    Going backward in the graph find a previous state that is...
     *    a) ... part of the result set and ...
     *    b) ... has the same number of matching terms.
     *
     * The algorithm tend to produce multiple short sequences.
     *
     * List of consecutive states from the provenance graph:
     * ```
     * [
     *    {id: 0, num: 2},
     *    {id: 1, num: 1},
     *    {id: 2, num: 1},
     *    {id: 3, num: 0}, // just for demonstration, should be excluded from the result set before
     *    {id: 4, num: 1},
     *    {id: 5, num: 2},
     *    {id: 6, num: 2},
     * ]
     * ```
     *
     * Results in the following sequences (ordered by number of matching terms):
     * ```
     * [
     *    // 2 matching terms:
     *    [
     *      [{id: 0, num: 2}], // sequence 1
     *      [{id: 5, num: 2}, {id: 6, num: 2}], // sequence 2
     *    ],
     *    // 1 matching term:
     *    [
     *      [{id: 1, num: 1}, {id: 2, num: 1}], // sequence 3
     *      [{id: 4, num: 1}], // sequence 4
     *    ],
     *    // 0 matching terms:
     *    [
     *      [{id: 3, num: 0}],
     *    ]
     * ]
     * ```
     *
     * @param {ISearchResult[]} results
     * @returns {ISearchResultSequence[]}
     */
    groupIntoSequences(results) {
        const lookup = new Map();
        // create lookup for faster access of matching terms per state node
        results.forEach((r) => {
            lookup.set(r.state.node, r.matchingIndicesStr());
        });
        return d3.nest()
            .key((d) => d.numMatchingTerms + ' matching terms')
            .key((d) => d.matchingIndicesStr())
            .key((d) => {
            let firstStateNode = d.state.node;
            let bakStateNode = firstStateNode;
            // continue as long as previous state is still available in the search results and
            // the number of matching terms are still equal. Otherwise create a new sequence.
            while (lookup.has(firstStateNode) && lookup.get(firstStateNode) === d.matchingIndicesStr()) {
                bakStateNode = firstStateNode;
                firstStateNode = firstStateNode.previousState;
            }
            return String(bakStateNode.id);
        })
            .sortValues((a, b) => a.state.node.id - b.state.node.id)
            .entries(results)
            // </end> of d3.nest -> continue with nested array
            //.map((d) => { // debug
            //  console.log(d );
            //  return d;
            //})
            // flatten the array twice
            .reduce((prev, curr) => prev.concat(curr.values), [])
            .reduce((prev, curr) => prev.concat(curr.values), [])
            // flatten once more and create a sequence from search results array
            .map((d) => new SearchResultSequence(d.values));
    }
    updateResults(sequences, clearContent = false) {
        if (clearContent) {
            this.$searchResults.selectAll('*').remove(); // clear DOM list
        }
        if (sequences.length === 0) {
            return;
        }
        const widthScale = d3.scale.linear().domain([0, 1]).range([0, 100]);
        const $seqLi = this.createSequenceDOM(this.$searchResults, sequences, widthScale);
        this.createStateListDOM($seqLi.select('.states'), widthScale);
    }
    /**
     *
     * @param $parent
     * @param sequences
     * @param widthScale
     * @returns {selection.Update<ISearchResultSequence>}
     */
    createSequenceDOM($parent, sequences, widthScale) {
        const that = this;
        const hasThumbnails = (ThumbnailUtils.areThumbnailsAvailable(this.data)) ? '1' : '0';
        sequences.sort((a, b) => b.topResult.weightedSimilarity - a.topResult.weightedSimilarity);
        const $seqLi = $parent
            .selectAll('li.sequence')
            .data(sequences, (d) => d.id)
            .order();
        $seqLi.enter().append('li')
            .classed('sequence', true)
            // set child elements here to avoid reloading when manipulating the weights
            .html(function (d) {
            const groups = d3.nest()
                .key((d) => d.group)
                .key((prop) => d.topResult.query.propValues.find((p) => p.id === prop.id) ? 'match' : 'no_match').sortKeys(d3.ascending)
                .entries(d.topResult.state.propValues);
            const terms = groups
                .map((group) => {
                const key = (group.key) ? `<b>${group.key}</b>: ` : '';
                const values = group.values
                    .map((group) => {
                    return group.values
                        .map((prop) => (group.key === 'match') ? `<span class="match">${prop.text}</span>` : prop.text)
                        .join(', ');
                });
                return key + values.join(', ');
            })
                .join('<br>');
            let seqIconId = '';
            let seqLength = '';
            switch (d.searchResults.length) {
                case 1:
                    seqIconId = 'one-state';
                    seqLength = '';
                    break;
                case 2:
                    seqIconId = 'two-states';
                    seqLength = '';
                    break;
                case 3:
                    seqIconId = 'three-states';
                    seqLength = '';
                    break;
                default:
                    seqIconId = 'n-states';
                    seqLength = String(d.searchResults.length - 2); // -2 because start and end state are explicitly displayed
            }
            const url = ThumbnailUtils.thumbnail_url(that.data, d.topResult.state.node, { width: 128, format: 'png' });
            const img = new Image();
            img.onload = () => {
                d3.select(this).select('.prov-ret-thumbnail > .loading').classed('hidden', true);
            };
            img.src = url;
            if (img.complete) {
                img.onload();
            }
            const topResultActive = (d.topResult.isActiveInMainView || that.data.act === d.topResult.state.node) ? 'active' : '';
            return `
          <div class="top-result ${topResultActive}" data-has-thumbs="${hasThumbnails}" data-score="${d.topResult.weightedSimilarity.toFixed(2)}">
            <div class="prov-ret-thumbnail">
              <svg role="img" viewBox="0 0 128 32" class="loading" preserveAspectRatio="xMinYMin meet">
                <use xlink:href="#loading-animation"></use>
              </svg>
              <div class="img" style="background-image: url(${url})"></div>
            </div>
            <div class="title" href="#" title="${d.topResult.state.node.name}">${d.topResult.state.node.name}</div>
            <div class="result-terms"><small>${terms}</small></div>
            <div class="seq-length" title="Click to show sequence of matching states">
              <svg role="img" viewBox="0 0 100 40" class="svg-icon" preserveAspectRatio="xMinYMin meet">
                <use xlink:href="#${seqIconId}" id="blabla"></use>
              </svg>
              <span>${seqLength}</span>
            </div>
            <ul class="similarity-bar"></ul>
          </div>
          <ol class="states hidden"></ol>
        `;
        })
            .each(function () {
            const $terms = d3.select(this).select('.result-terms');
            $terms.classed('expandable', $terms.select('small').node().getBoundingClientRect().height >
                $terms.node().getBoundingClientRect().height);
        });
        $seqLi.each(function (d) {
            const containsActive = (searchResults) => {
                return searchResults.some((e) => e.isActiveInMainView || that.data.act === e.state.node);
            };
            d3.select(this).select('.top-result')
                .classed('active', () => containsActive([d.topResult]));
            d3.select(this).select('.seq-length')
                .classed('active', () => containsActive(d.searchResults))
                .classed('first', () => containsActive(d.searchResults.slice(0, 1)))
                .classed('center', () => containsActive(d.searchResults.slice(1, -1)))
                .classed('last', () => containsActive(d.searchResults.slice(-1)));
        });
        $seqLi.exit().remove();
        const hoverMultipleStateNodes = (seq, operation) => {
            const stateNodeIds = seq.searchResults.map((d) => this.data.states.indexOf(d.state.node));
            // hover multiple stateNodeIds
            this.data.select(ProvenanceGraphDim.State, SelectionUtils.hoverSelectionType, stateNodeIds, operation);
        };
        $seqLi.select('.seq-length')
            .on('mouseenter', (d) => {
            d3.event.stopPropagation();
            hoverMultipleStateNodes(d, SelectOperation.SET);
        })
            .on('mouseleave', (d) => {
            d3.event.stopPropagation();
            hoverMultipleStateNodes(d, SelectOperation.REMOVE);
        })
            .on('click', (d) => {
            d3.event.stopPropagation();
            // expand/collapse only for sequence length > 1
            //if(d.searchResults.length > 1) {
            const li = d3.event.target.parentNode.parentNode;
            li.classList.toggle('active');
            li.querySelector('.states').classList.toggle('hidden');
            //}
            return false;
        });
        const addMouseListener = ($elem) => {
            $elem
                .on('mouseenter', (d) => {
                d3.event.stopPropagation();
                //this.data.selectState(<StateNode>d.topResult.state.node, idtypes.SelectOperation.SET, idtypes.hoverSelectionType);
                hoverMultipleStateNodes(d, SelectOperation.SET);
                const li = d3.event.target.parentNode.parentNode;
                li.classList.toggle('hover');
            })
                .on('mouseleave', (d) => {
                d3.event.stopPropagation();
                //this.data.selectState(<StateNode>d.topResult.state.node, idtypes.SelectOperation.REMOVE, idtypes.hoverSelectionType);
                hoverMultipleStateNodes(d, SelectOperation.REMOVE);
                const li = d3.event.target.parentNode.parentNode;
                li.classList.toggle('hover');
            })
                .on('click', (d) => {
                d3.event.stopPropagation();
                this.setLastStateBeforeSearch();
                this.data.selectState(d.topResult.state.node, SelectionUtils.toSelectOperation(d3.event));
                this.data.jumpTo(d.topResult.state.node);
                return false;
            });
        };
        addMouseListener($seqLi.select('.title'));
        addMouseListener($seqLi.select('.result-terms'));
        addMouseListener($seqLi.select('.prov-ret-thumbnail'));
        const $seqSimBar = $seqLi.select('.similarity-bar')
            .attr('data-tooltip', (d) => {
            const textSim = d.topResult.query.propValues.map((p, i) => {
                return { text: p.text, similarity: d.topResult.weightedSimilarities[i] };
            });
            textSim.push({ text: 'Total', similarity: d.topResult.weightedSimilarity });
            return textSim.map((t) => `${t.text}:\t${d3.round(widthScale(t.similarity), 2)}%`).join('\n');
        })
            .selectAll('li.bar')
            .data((d) => {
            return d.topResult.weightedSimilarities.map((sim, i) => {
                const propValue = d.topResult.query.propValues[i];
                return {
                    id: propValue.id,
                    text: propValue.text,
                    weight: d.topResult.query.weights[i],
                    color: d.topResult.query.colors[i],
                    width: widthScale(sim),
                };
            });
        });
        $seqSimBar.enter().append('li').classed('bar', true);
        $seqSimBar
            .attr('data-weight', (d) => `${d3.round(d.weight, 2)}%`)
            .style('background-color', (d) => d.color)
            .style('width', (d) => `${d3.round(d.width, 2)}%`);
        $seqSimBar.exit().remove();
        return $seqLi;
    }
    /**
     *
     * @param $parent
     * @param widthScale
     */
    createStateListDOM($parent, widthScale) {
        const $stateLi = $parent
            .selectAll('li.state')
            .data((seq) => seq.searchResults, (d) => d.id)
            .order();
        $stateLi.enter().append('li')
            .classed('state', true)
            .classed('active', (d) => d.isActiveInMainView || this.data.act === d.state.node)
            .html((d) => {
            return `
          <div class="seq-state-result" data-score="${d.weightedSimilarity.toFixed(2)}" data-is-top="${d.isTopResult ? 1 : 0}">
            <div class="circle"><i class="fas fa-circle glyph"></i></div>
            <div class="title" href="#">${d.state.node.name}</div>
            <div class="best-match" title="Best match in this sequence">#1</div>
            <ul class="similarity-bar"></ul>
          </div>
        `;
        });
        $stateLi.classed('active', (d) => d.isActiveInMainView || this.data.act === d.state.node);
        $stateLi.exit().remove();
        $stateLi.select('.seq-state-result')
            .on('mouseenter', (d) => {
            d3.event.stopPropagation();
            this.data.selectState(d.state.node, SelectOperation.SET, SelectionUtils.hoverSelectionType);
        })
            .on('mouseleave', (d) => {
            d3.event.stopPropagation();
            this.data.selectState(d.state.node, SelectOperation.REMOVE, SelectionUtils.hoverSelectionType);
        })
            .on('click', (d) => {
            d3.event.stopPropagation();
            this.setLastStateBeforeSearch();
            this.data.selectState(d.state.node, SelectionUtils.toSelectOperation(d3.event));
            this.data.jumpTo(d.state.node);
            return false;
        });
        const $simBar = $stateLi.select('.similarity-bar')
            .attr('data-tooltip', (d) => {
            const textSim = d.query.propValues.map((p, i) => {
                return { text: p.text, similarity: d.weightedSimilarities[i] };
            });
            textSim.push({ text: 'Total', similarity: d.weightedSimilarity });
            return textSim.map((t) => `${t.text}:\t${d3.round(widthScale(t.similarity), 2)}%`).join('\n');
        })
            .selectAll('li.bar')
            .data((d) => {
            return d.weightedSimilarities.map((sim, i) => {
                const propValue = d.query.propValues[i];
                return {
                    id: propValue.id,
                    text: propValue.text,
                    weight: d.query.weights[i],
                    color: d.query.colors[i],
                    width: widthScale(sim),
                };
            });
        });
        $simBar.enter().append('li').classed('bar', true);
        $simBar
            .attr('data-weight', (d) => `${d3.round(d.weight, 2)}%`)
            .style('background-color', (d) => d.color)
            .style('width', (d) => `${d3.round(d.width, 2)}%`);
        $simBar.exit().remove();
    }
    static create(data, parent, options = {}) {
        return new ProvRetrievalPanel(data, parent, options);
    }
}
/**
 * Capture the `StateNode.visState` that haven not been persisted yet and index them.
 *
 * NOTE:
 * In order to capture a StateNode the application must jump to each state and capture it.
 * Depending on the machine and number of states that might results in long loading times.
 *
 * @type {boolean}
 */
ProvRetrievalPanel.CAPTURE_AND_INDEX_NON_PERSISTED_STATES = false;
//# sourceMappingURL=ProvRetrievalPanel.js.map