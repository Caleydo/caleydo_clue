
import * as lineup from 'lineupjs/src';
import * as $ from 'jquery';
import * as d3 from 'd3';

import * as ranges from 'phovea_core/src/range';
import * as idtypes from 'phovea_core/src/idtype';
import * as provenance from 'phovea_core/src/provenance';
import * as vis from 'phovea_core/src/vis';

import {SimHash, ISimilarityCategory} from 'phovea_core/src/provenance/SimilarityHash';
import {mod} from 'phovea_core/src/index';
import StateNode from 'phovea_core/src/provenance/StateNode';
import ProvenanceGraph from 'phovea_core/src/provenance/ProvenanceGraph';
import {SimVisStateNode} from 'phovea_core/src/provenance/StateNode';
import {MatchedTokenTree} from 'phovea_core/src/provenance/token/MatchedTokenTree';


interface ILineUpColumnDesc {
  label: string;
  type: string;
  column: string;
  domain: number[];
  color: string;
}


export class LineupStateView extends vis.AVisInstance {
  protected node;

  private lstack;
  private cstack;
  private rstack;

  private lu;
  private luDataProvider;
  private arr;


  constructor(container, public data:provenance.ProvenanceGraph) {
    super();
    this.node = container;
    this.initialize();
    SimHash.hasher.on('weights_changed', this.updateWeights.bind(this));
    this.data.on('add_state', this.onExecutionStartedListener.bind(this));
    this.data.on('action-execution-complete', this.onStateAddedListener.bind(this));
    this.data.on('select_state', this.stateSelectionChanged.bind(this));
    return this;
  }

  private executionToStateRunning:StateNode = null;

  onExecutionStartedListener(event:any, state:SimVisStateNode) {
    if (this.executionToStateRunning === null) {
      this.executionToStateRunning = state;
    } else {
      throw Error('Two executions are run in parallel');
    }
  }

  onStateAddedListener(event:any, state:SimVisStateNode) {
    if (this.executionToStateRunning === null) {
      return;
    }
    if (this.executionToStateRunning === state) {
      this.recalcStateSim(event, state);
      this.executionToStateRunning = null;
    }
  }

  stateSelectionChanged(event:any, state:SimVisStateNode) {
    if (event.args[1] === 'selected') {
      this.recalcStateSim(event, state);
    }
  }

  recalcStateSim(event:any, state:SimVisStateNode) {
    //this.fillArr();
    //this.luDataProvider.data =this.arr
    //this.lu.update()
    this.lu.destroy();
    this.initialize(state);
  }

  fillArr(state:SimVisStateNode) {
    this.arr = [];
    //let state:StateNode = this.data.selectedStates(idtypes.defaultSelectionType)[0]
    if (state === undefined || state === null) {
      return;
    }
    let allstates = this.data.states;
    allstates.forEach(function (s:SimVisStateNode) {
      s.lineUpIndex = -1;
    });
    let ownStateAlreadyFound:boolean = false;
    for (let i = 0; i < allstates.length; i++) {
      let currState:SimVisStateNode = <SimVisStateNode>allstates[i];
      if (state === currState) {
        ownStateAlreadyFound = true;
        continue;
      }
      let sim = state.getSimForLineupTo(currState);
      this.arr = this.arr.concat({
        'ld': sim[0][0], 'lv': sim[0][1], 'ls': sim[0][2], 'll': sim[0][3], 'la': sim[0][4],
        'cd': sim[1][0], 'cv': sim[1][1], 'cs': sim[1][2], 'cl': sim[1][3], 'ca': sim[1][4],
        'rd': sim[2][0], 'rv': sim[2][1], 'rs': sim[2][2], 'rl': sim[2][3], 'ra': sim[2][4], 'state': currState
      });
      currState.lineUpIndex = ownStateAlreadyFound ? i-1 : i;
    }
  }


  updateWeights() {
    let width:number = 48;
    let weights = SimHash.getWeighting();
    this.lstack.setWeights(weights);
    this.lstack.setWidth(width);
    this.cstack.setWeights(weights);
    this.cstack.setWidth(width);
    this.rstack.setWeights(weights);
    this.rstack.setWidth(width);
    this.lu.update();
  }


  initialize(reason:SimVisStateNode = null) {
    const createDesc = (pos:string):ILineUpColumnDesc[] => {
      return SimHash.CATEGORIES2.map((d) => {
        return {
          label: d.name,
          type: 'number',
          column: pos + d.name[0],
          domain: [0,1],
          color: d.color
        };
      });
    };

    const descLeft = createDesc('l');
    const descCenter = createDesc('c');
    const descRight = createDesc('r');

    this.fillArr(reason);
    this.luDataProvider = new lineup.provider.LocalDataProvider(this.arr, [...descLeft, ...descCenter, ...descRight]);
    const r = this.luDataProvider.pushRanking();

    const createStackedColumn = (label:string, desc:ILineUpColumnDesc[]) => {
      const stackedColumn = this.luDataProvider.create(lineup.model.createStackDesc(label));
      r.push(stackedColumn);
      desc.forEach((d) => stackedColumn.push(this.luDataProvider.create(d)));
      return stackedColumn;
    };

    this.lstack = createStackedColumn('Active', descLeft);
    this.cstack = createStackedColumn('Intersection', descCenter);
    this.rstack = createStackedColumn('Ranked', descRight);

    this.lu = lineup.create(this.luDataProvider, this.node, {
      /*
       additionalDesc : [
       lineup.model.StackColumn.desc('+ Stack')
       ],
       */
      /*htmlLayout: {
       autoRotateLabels: true
       },*/
      body: {
        renderer: 'svg',
        visibleRowsOnly: false
      },
      manipulative: false
    });
    this.cstack.sortByMe(false);
    this.updateWeights();
    this.lu.update();
    this.registerListeners();
  }

  registerListeners() {
    this.lu.on('selectionChanged', this.selectStateListener.bind(this));
    this.lu.on('hoverChanged', this.hoverListener.bind(this));
    this.data.on('select', this.selectionChangedListener.bind(this));
  }

  private selectionChangedListener = (event:any, type:string, act:ranges.Range) => {
    if (type === idtypes.hoverSelectionType) {
      const selectedStates = this.data.selectedStates(type);
      if (selectedStates.length === 0) {
        this.luDataProvider.clearSelection();
      } else {
        this.luDataProvider.select((<SimVisStateNode>selectedStates[0]).lineUpIndex);
      }
    }

  };

  private lastHovered:number = -1;

  private hoverListener(index:number) {
    if (index < 0) {
      this.arr[this.lastHovered].state.isHoveredInLineUp = false;
      this.lastHovered = -1;
    } else {
      //console.log(this.arr[index])
      this.arr[index].state.isHoveredInLineUp = true;
      this.lastHovered = index;
    }
    this.data.fire('linupHoverChanged');
  }

  private selectStateListener(index:number) {
    if (index < 0) {
      this.data.fire('stateSimLU-selection', null);
    } else {
      this.data.fire('stateSimLU-selection', this.arr[index].state);
    }
  }
}

export class WeightInterface {

  protected cumSum:number[] = [];
  protected scalefactor:number = (300 - 4) / 100;

  protected catContainer;
  protected barContainer;

  protected closeWeightSelection;
  protected openWeightSelection;

  constructor(container) {
    this.catContainer = container;
    this.barContainer = this.catContainer.select('.barContainer');
    let rawWeights = SimHash.getWeighting();
    this.cumSum[0] = 0;
    for (let i = 1; i <= rawWeights.length; i++) {
      this.cumSum[i] = this.cumSum[i - 1] + rawWeights[i - 1];
    }

    //this.update(false);
    this.initialize();
    return this;
  }

  public close() {
    this.closeWeightSelection();
  }

  protected catsWeightMap(name):ISimilarityCategory {
    return SimHash.CATEGORIES2.filter((d) => d.name === name)[0];
  }

  protected getNextActive(index) {
    let nextIndex = -1;
    for (let i = 1; i < SimHash.CATEGORIES2.length; i++) {
      if (SimHash.CATEGORIES2[mod(index + i, 5)].active) {
        nextIndex = mod(index + i, 5);
        break;
      }
    }
    return nextIndex;
  }

  protected getPreviousActive(index) {
    let nextIndex = -1;
    for (let i = 1; i < SimHash.CATEGORIES2.length; i++) {
      if (SimHash.CATEGORIES2[mod(index - i, 5)].active) {
        nextIndex = mod(index - i, 5);
        break;
      }
    }
    return nextIndex;
  }


  protected update(transitions:boolean) {
    let _that = this;
    let transitionDuration = 300;
    let bars = this.barContainer.selectAll('div')
      .data(SimHash.CATEGORIES2, function (d) {
        return d.name;
      });
    let lines = d3.select('.lineContainer').selectAll('line')
      .data(SimHash.CATEGORIES2, function (d) {
        return d.name;
      });

    //update


    //enter
    bars.enter()
      .append('div')
      .classed('bar', true)
      .classed('adjustable', true);
    lines.enter()
      .append('line')
      .style('stroke', function (d) {
        return d.color;
      });

    //update+enter
    let b = <any>bars;
    if (transitions) {
      b = <any>bars.transition().duration(transitionDuration);
    }
    b.style('left', '0px')
      .style('height', function (d) {
        return d.weight * _that.scalefactor + 'px';
      })
      .style('top', function (d, i) {
        return _that.cumSum[i] * _that.scalefactor + 'px';
      })
      .style('width', '30px')
      .text('');


    let l = <any>lines;
    if (transitions) {
      l = <any>lines.transition().duration(transitionDuration);
    }
    l.style('stroke', function (d) {
      return d.color;
    })
      .attr('y1', function (d, i) {
        return (_that.cumSum[i] + _that.cumSum[i + 1]) / 2 * _that.scalefactor + 10;
      })
      .attr('y2', function (d, i) {
        return i * 26 + 90 + 13;
      })
      .attr('x1', '50')
      .attr('x2', '120')
      .style('opacity', function (d) {
        return d.active ? 1 : 0;
      });


    d3.selectAll('.categoryUnit label').transition()
      .delay(transitionDuration)
      .style('background-color', function() {
        return d3.hsl(_that.catsWeightMap($(this).attr('title')).color).brighter(0.7).toString();
      });

    //update handlePos
    let handles = this.catContainer.selectAll('.chart_handle');
    let h = <any>handles;
    if (transitions) {
      h = <any>handles.transition().duration(transitionDuration);
    }
    h.style('left', '10px')
      .style('top', function (d, i) {
        return _that.cumSum[i + 1] * _that.scalefactor + 'px';
      })
      .style('opacity', function () {
        let setActive = _that.catsWeightMap($(this).attr('id')).active;
        let index = SimHash.CATEGORIES2.findIndex((d) => d.name === $(this).attr('id'));
        if (_that.getNextActive(index) <= index) {
          setActive = false;
        }
        return setActive ? 1 : 0;
      })
      .style('z-index', function () {
        return _that.catsWeightMap($(this).attr('id')).active ? 4 : -4;
      });

    //update textfields
    let label = <any>d3.selectAll('.categoryUnit input.catValue');
    if (transitions) {
      label = label.transition().duration(transitionDuration);
    }
    label.attr('value', function () {
      return Math.round(SimHash.CATEGORIES2.filter((d) => d.name === $(this).attr('id'))[0].weight) / 100;
    });
  }


  initialize() {
    let _that = this;
    let categoryUnit = function (catName:string, defaultWeight:number, faString:string):string {
      let capitalizeFirstLetter = function (string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
      };
      return (
      `<div class="categoryUnit" id="${catName}">
      <input class="catValue" type="number" min="0" max="1" value="${defaultWeight / 100}" id="${catName}">
      <label class="btn btn-default btn-xs" title="${catName}">
      <input type="checkbox" autocomplete="off" name="category" value="${catName}"> <i class="fa ${faString}"></i>${capitalizeFirstLetter(catName)}
      </label>
      </div>`);
    };

    const $controlContainer = $('.controlContainer');
    SimHash.CATEGORIES2.forEach((d) => {
      $controlContainer.append(categoryUnit(d.name, d.weight, d.icon));
    });
    $('.provenance-similarity-vis').hide();

    $('.categoryUnit label input[type=checkbox]').prop('checked', true);

    let handleHtml = function (id:string) {
      return (
      `<div class="chart_handle" id="${id}">
      <i class="fa fa-arrow-right" aria-hidden="true"></i>
      </div>`);
    };

    const $catWeightContainer = $('.catWeightContainer');
    SimHash.CATEGORIES2.forEach((d) => {
      $catWeightContainer.append(handleHtml(d.name));
    });

    const dragResize = d3.behavior.drag()
      .on('drag', function () {
        let x = d3.mouse(_that.barContainer.node())[1] / _that.scalefactor;
        if (x > 100) {
          x = 100;
        }
        let id = SimHash.CATEGORIES2.findIndex((d) => d.name === $(this).attr('id'));
        let diff = _that.cumSum[id + 1] - x;
        SimHash.CATEGORIES2[id].weight -= diff;
        let next = _that.getNextActive(id);
        let prev = _that.getPreviousActive(id);
        //let isLast = next <= id;
        if (next <= id) {
          SimHash.CATEGORIES2[prev].weight += diff;
        } else {
          SimHash.CATEGORIES2[next].weight += diff;
        }

        _that.cumSum[0] = 0;
        for (let i = 1; i <= SimHash.CATEGORIES2.length; i++) {
          _that.cumSum[i] = _that.cumSum[i - 1] + SimHash.CATEGORIES2[i - 1].weight;
        }
        _that.update(false);
        SimHash.hasher.fire('weights_changed');
        //that.update()
      });
    d3.selectAll('.chart_handle').call(dragResize);


    this.closeWeightSelection = function () {
      let _that = this;
      $('.controlContainer').hide();
      d3.select('.controlContainer').transition()
        .duration(150)
        .style('opacity', 0);
      this.barContainer.style('width', '280px')
        .transition()
        .style('left', '0px')
        .style('top', '0px')
        .style('width', '300px');
      this.catContainer.transition()
        .delay(300)
        .duration(400)
        .style('background-color', '#60AA85').each(function () {
          _that.catContainer
            .classed('closed', true)
            .classed('open', false);
        });
      this.catContainer.transition()
        .delay(75)
        .duration(100)
        .style('height', '22px');
      this.catContainer.selectAll('.chart_handle').transition()
        .style('opacity', 0)
        .duration(100)
        .each(function () {
          $('.chart_handle').hide();
        });
      d3.select('.lineContainer').transition()
        .duration(100)
        .style('opacity', 0)
        .each(function () {
          $('lineContainer').hide();
        });
      d3.select('.lineContainer').transition()
        .delay(75)
        .duration(100)
        .style('height', '22px');
      this.barContainer.selectAll('.adjustable').transition()
        .text(function (d) {
          return (d.name + ' ' + Math.round(d.weight) + '%');
        })
        .style('top', '0px')
        .style('left', function (d, i) {
          return _that.cumSum[i] * _that.scalefactor + 'px';
        })
        .style('width', function (d) {
          return d.weight * _that.scalefactor + 'px';
        })
        .style('height', '22px')
        .style('background-color', function (d) {
          return d.color;
        })
        //.style('opacity', 0.8)
        .style('color', function (d, i) {
          return i >= 3 ? 'black' : 'white';
        });
      //.duration(2500)
      this.barContainer.selectAll('.adjustable')
        .classed('compact', true)
        .classed('adjustable', false);
    }.bind(this);

    this.openWeightSelection = function () {
      let _that = this;
      $('.controlContainer').show();
      $('.lineContainer').show();
      d3.select('.lineContainer').transition()
        .delay(150)
        .duration(150)
        .style('height', '300px')
        .style('opacity', 1);
      d3.select('.controlContainer').transition()
        .delay(150)
        .duration(150)
        .style('opacity', 1);
      $('.chart_handle').show();
      this.catContainer.selectAll('.chart_handle')
        .transition()
        .delay(150)
        .duration(150);
      this.barContainer.style('width', '30px')
        .transition()
        .style('left', '20px')
        .style('top', '10px');
      this.catContainer.transition()
        .style('height', '320px');
      this.barContainer.selectAll('.compact').transition()
        .style('left', '0px')
        .style('height', function (d) {
          return d.weight * _that.scalefactor + 'px';
        })
        .style('top', function (d, i) {
          return _that.cumSum[i] * _that.scalefactor + 'px';
        })
        .style('width', '30px')
        .text('');
      //.duration(1500)
      this.barContainer.selectAll('.compact')
        .classed('compact', false)
        .classed('adjustable', true);
      this.catContainer.classed('closed', false)
        .classed('open', true);
      this.update(true);
    }.bind(this);

    this.closeWeightSelection();
    this.update(false);
    this.catContainer.on('click', this.openWeightSelection);
    this.catContainer.on('mouseleave', this.closeWeightSelection);

    d3.selectAll('.categoryUnit label input').on('change', function () {
      let index = SimHash.CATEGORIES2.findIndex((d) => d.name === $(this).attr('value'));
      if (SimHash.CATEGORIES2[index].active) {
        //deactivate
        SimHash.CATEGORIES2[_that.getNextActive(index)].weight += SimHash.CATEGORIES2[index].weight;
        SimHash.CATEGORIES2[index].weight = 0;
      } else {
        //activate
        let nextIndex = _that.getNextActive(index);
        if (nextIndex < 0) {
          SimHash.CATEGORIES2[index].weight = 100;
        } else {
          let val = SimHash.CATEGORIES2[nextIndex].weight;
          SimHash.CATEGORIES2[index].weight = val / 2;
          SimHash.CATEGORIES2[nextIndex].weight = val / 2;
        }
      }
      SimHash.CATEGORIES2[index].active = !SimHash.CATEGORIES2[index].active;
      _that.cumSum[0] = 0;
      for (let i = 1; i <= SimHash.CATEGORIES2.length; i++) {
        _that.cumSum[i] = _that.cumSum[i - 1] + SimHash.CATEGORIES2[i - 1].weight;
      }
      _that.update(true);
      SimHash.hasher.fire('weights_changed');
      //that.update();
    });
  }
}

export class TokenTreeVisualization {

  private partitionAS = null;
  private bottom_state = null;
  private bottom_stateContainer = null;
  private top_state = null;
  private top_stateContainer = null;
  private bandContainer = null;
  private bandSpace = null;
  private _tree:MatchedTokenTree = null;
  //private diagonal = null;
  //private duration = null;
  private container = null;
  private data = null;

  constructor(container, data:ProvenanceGraph) {
    this.container = container;
    this.data = data;
    this.initialize();
    return this;
  }

  initialize() {
    d3.select(self.frameElement).style('height', '300px');
    //SimHash.hasher.on('weights_changed', this.updateWeights.bind(this))
    this.data.on('add_state', this.onExecutionStartedListener.bind(this));
    this.data.on('action-execution-complete', this.onStateAddedListener.bind(this));
    this.data.on('select_state', this.stateSelectionChanged.bind(this));
    this.data.on('stateSimLU-selection', this.lineupSelectionListener.bind(this));
    SimHash.hasher.on('weights_changed', this.weightsChangedListener.bind(this));

    this.bottom_stateContainer = this.container.append('div');
    this.bottom_stateContainer.classed('tokenStructViz', true)
      .style('height', '186px')
      .style('order', 3);
    this.bottom_state = this.bottom_stateContainer.append('div');
    this.bottom_state.classed('bottom-state', true);

    this.bandContainer = this.container.append('div');
    this.bandContainer.classed('stateSepSpace', true)
      .style('height', '30px')
      .style('order', 2);
    this.bandSpace = this.bandContainer.append('div');
    this.bandSpace.classed('bandSpace', true);

    this.top_stateContainer = this.container.append('div');
    this.top_stateContainer.classed('tokenStructViz', true)
      .style('height', '186px')
      .style('order', 1);
    this.top_state = this.top_stateContainer.append('div');
    this.top_state.classed('top-state', true);

    this.findAndInitializeTree();
    //.style('heigth', '200');
  }

  private luSelectedState:StateNode = null;
  private activeState:StateNode = null;

  weightsChangedListener(event:any) {
    this.update(this._tree.rootNode);
  }

  lineupSelectionListener(event:any, state:provenance.StateNode) {
    this.luSelectedState = state;
    this.findAndInitializeTree();
  }

  private executionToStateRunning:StateNode = null;

  onExecutionStartedListener(event:any, state:provenance.StateNode) {
    if (this.executionToStateRunning === null) {
      this.executionToStateRunning = state;
    } else {
      throw Error('Two executions are run in paralell');
    }
  }

  onStateAddedListener(event:any, state:provenance.StateNode) {
    if (this.executionToStateRunning === null) {
      return;
    }
    if (this.executionToStateRunning === state) {
      this.findAndInitializeTree();
      this.executionToStateRunning = null;
    }
  }

  stateSelectionChanged(event:any, state:provenance.StateNode) {
    if (event.args[1] === 'selected') {
      this.activeState = state;
      this.findAndInitializeTree();
    }
  }

  private stateVizX = null;
  private stateVizY = null;

  findAndInitializeTree() {
    this.activeState = this.data.act;
    this._tree = this.activeState.getMatchedTreeWithOtherState(this.luSelectedState);
    this.partitionAS = (<any>d3.layout).partition();
    this.partitionAS.children(function (d) {
      return d.childsAndDummyChilds;
    })
      .value(function (d) {
        return d.getScaledSize;
      })
      .sort(function (a, b) {
        return a.id - b.id;
      });

    this.top_stateContainer.selectAll('.top-state').remove();
    this.top_state = this.top_stateContainer.append('div');
    this.top_state.classed('top-state', true);

    this.bandContainer.selectAll('.bandSpace').remove();
    this.bandSpace = this.bandContainer.append('div');
    this.bandSpace.classed('bandSpace', true);

    this.bottom_stateContainer.selectAll('.bottom-state').remove();
    this.bottom_state = this.bottom_stateContainer.append('div');
    this.bottom_state.classed('bottom-state', true);
    this.update(this._tree.rootNode);
  }

  private padding:number = 8; //px

  update(source) {
    const that = this;
    this.stateVizX = d3.scale.linear().range([0, this.bottom_state.node().getBoundingClientRect().width]);
    this.stateVizY = d3.scale.linear().range([0, this.bottom_state.node().getBoundingClientRect().height]);

    const activeStateIsLeft:boolean = (that._tree.leftState !== that.activeState);
    // Compute the new tree layout.
    let nodes = that.partitionAS(that._tree.rootNode);


    // TOP STATE
    let node = this.top_state.selectAll('div')
      .data(nodes, function (d) {
        return d === undefined ? 0 : d.id;
      })
      .style('left', function (d) {
        return that.stateVizX(d.x) + that.padding + 'px';
      })
      .style('top', function (d) {
        return that.stateVizY(d.y) + that.padding + 'px';
      })
      .style('height', function (d) {
        return that.stateVizY(d.dy) + 'px';
      })
      .style('width', function (d) {
        return that.stateVizX(d.dx) + 'px';
      });

    // Enter any new nodes at the parent's previous position.
    let nodeEnter = node.enter().append('div')
      .classed('tokenWrapper', true)
      .style('left', function (d) {
        return that.stateVizX(d.x) + that.padding + 'px';
      })
      .style('top', function (d) {
        return that.stateVizY(d.y) + that.padding + 'px';
      })
      .style('height', function (d) {
        return that.stateVizY(d.dy) + 'px';
      })
      .style('width', function (d) {
        return that.stateVizX(d.dx) + 'px';
      })
      .html(function (d) {
        if (d.isRoot) {
          return `<div class="visStateDescription">Selected State</div>`;
        }
        let isVisible:boolean = true;
        if (!d.isPaired) {
          if (!activeStateIsLeft) {
            if (d.hasLeftToken) {
              isVisible = false;
            }
          } else {
            if (d.hasRightToken) {
              isVisible = false;
            }
          }
        }
        if (d.importance < 0.02) {
          isVisible = false;
        }
        if (!isVisible) {
          return `<div class="nonPairedToken">`;
        }
        let bgcolor:string = d.isLeafNodeWithoutDummyChilds ? SimHash.getCategoryColor(d.categoryName) : 'white';
        let html = '';
        let text = d.name;
        html = `<div title="${text}" class="token center" style="background-color: ${bgcolor}">${text}</div>`;
        return html;
      });


    // BOTTOM STATE
    node = this.bottom_state.selectAll('div')
      .data(nodes, function (d) {
        return d === undefined ? 0 : d.id;
      })
      .style('left', function (d) {
        return that.stateVizX(d.x) + that.padding + 'px';
      })
      .style('bottom', function (d) {
        return that.stateVizY(d.y) + that.padding + 'px';
      })
      .style('height', function (d) {
        return that.stateVizY(d.dy) + 'px';
      })
      .style('width', function (d) {
        return that.stateVizX(d.dx) + 'px';
      });

    // Enter any new nodes at the parent's previous position.
    nodeEnter = node.enter().append('div')
      .classed('tokenWrapper', true)
      .style('left', function (d) {
        return that.stateVizX(d.x) + that.padding + 'px';
      })
      .style('bottom', function (d) {
        return that.stateVizY(d.y) + that.padding + 'px';
      })
      .style('height', function (d) {
        return that.stateVizY(d.dy) + 'px';
      })
      .style('width', function (d) {
        return that.stateVizX(d.dx) + 'px';
      })
      .html(function (d) {
        if (d.isRoot) {
          return `<div class="visStateDescription">Active State</div>`;
        }
        let isVisible:boolean = true;
        if (!d.isPaired) {
          if (activeStateIsLeft) {
            if (d.hasLeftToken) {
              isVisible = false;
            }
          } else {
            if (d.hasRightToken) {
              isVisible = false;
            }
          }
        }
        if (d.importance < 0.01) {
          isVisible = false;
        }
        if (!isVisible) {
          return `<div class="nonPairedToken">`;
        }
        let bgcolor:string = d.isLeafNodeWithoutDummyChilds ? SimHash.getCategoryColor(d.categoryName) : 'white';
        return `<div title="${d.name}" class="token center" style="background-color: ${bgcolor}">${d.name}</div>`;
      });

    nodeEnter.selectAll('.visStateDescription')
      .style('transform', 'translate(0px, 9px');


    let band = this.bandSpace.selectAll('div')
      .data(nodes.filter((d) => d.isLeafNodeWithoutDummyChilds), (d) => d === undefined ? 0 : d.id)
      .style('left', (d) => that.stateVizX(d.x) + that.padding + 'px')
      .style('bottom', (d) =>  '-30px')
      .style('height', (d) =>  '92px')
      .style('width', (d) => that.stateVizX(d.dx) * d.tokenSimilarity + 'px');

    band.enter().append('div')
      .classed('bandWrapper', true)
      .style('left', (d) => that.stateVizX(d.x) + that.padding + 'px')
      .style('bottom', (d) =>  '-30px')
      .style('height', (d) =>  '92px')
      .style('width', (d) => that.stateVizX(d.dx) * d.tokenSimilarity + 'px')
      .html((d) => {
        let isVisible:boolean = true;
        if (!d.isPaired) {
          isVisible = false;
        }
        if (d.tokenSimilarity === 0) {
          isVisible = false;
        }
        if (d.importance < 0.01) {
          isVisible = false;
        }
        if (!isVisible) {
          return `<div class="nonMatchingBand">`;
        }
        let bgcolor = d3.hsl(SimHash.getCategoryColor(d.categoryName)).brighter(0.7).toString();
        return `<div class="band" style="background-color: ${bgcolor}">`;
      });

    let topStateVisible = that._tree.leftState.id === that._tree.rightState.id  ? 'hidden' : 'visible';
    that.top_stateContainer.style('visibility', topStateVisible);
    that.bandContainer.style('visibility', topStateVisible);
  }

  // Toggle children on click.
  click(d) {
    if (d.children) {
      d._children = d.children;
      d.children = null;
    } else {
      d.children = d._children;
      d._children = null;
    }
    this.update(d);
  }

}






















