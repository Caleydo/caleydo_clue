/**
 * Created by Samuel Gratzl on 01.09.2015.
 */


import {hash, mixin, onDOMNodeRemoved} from 'phovea_core/src';
import {EventHandler, fire, IEvent} from 'phovea_core/src/event';
import i18next from 'phovea_core/src/i18n';

/**
 * normalizes the given coordinates to sum up to one
 * @param arr
 * @returns {any}
 */
function normalize(arr: [number, number, number]): [number, number, number] {
  const sum = arr.reduce((a, b) => a + b, 0);
  return <[number, number, number]>arr.map((i) => i / sum);
}

/**
 * generic version of the CLUE mode, a combination of exploration, authoring, and normalization
 */
export class CLUEMode {
  private coord: [number, number, number];

  constructor(exploration: number, authoring: number, presentation: number) {
    this.coord = normalize([exploration, authoring, presentation]);
  }

  get exploration() {
    return this.coord[0];
  }

  get authoring() {
    return this.coord[1];
  }

  get presentation() {
    return this.coord[2];
  }

  value(index: number | string): number {
    if (typeof index === 'number') {
      return this.coord[index];
    } else if (typeof index === 'string') {
      const lookup = {e: this.coord[0], a: this.coord[1], p: this.coord[2]};
      return lookup[index.charAt(0).toLowerCase()];
    }
    return null;
  }

  /**
   * whether this mode is extreme, i.e., in one corner of the triangle
   * @returns {boolean}
   */
  get isAtomic() {
    return this.exploration === 1.0 || this.authoring === 1.0 || this.presentation === 1.0;
  }

  toString() {
    if (this.exploration === 1) {
      return 'E';
    }
    if (this.authoring === 1) {
      return 'A';
    }
    if (this.presentation === 1) {
      return 'P';
    }
    return '(' + this.coord.map((s) => (Math.round(s * 1000) / 1000).toString()).join('-') + ')';
  }
}

/**
 * mode factory by the given components
 * @param exploration
 * @param authoring
 * @param presentation
 * @returns {CLUEMode}
 */
function mode(exploration: number, authoring: number, presentation: number) {
  return new CLUEMode(exploration, authoring, presentation);
}

/**
 * shortcuts for the atomic modes
 * @type {{Exploration: CLUEMode, Authoring: CLUEMode, Presentation: CLUEMode}}
 */
export const modes = {
  Exploration: mode(1, 0, 0),
  Authoring: mode(0, 1, 0),
  Presentation: mode(0, 0, 1)
};

function fromString(s: string) {
  if (s === 'P') {
    return modes.Presentation;
  } else if (s === 'A') {
    return modes.Authoring;
  } else if (s === 'E') {
    return modes.Exploration;
  }
  const coords = s.slice(1, s.length - 1).split('-').map(parseFloat);
  return new CLUEMode(coords[0], coords[1], coords[2]);
}

/**
 * returns the default mode either stored in the hash or by default exploration
 */
function defaultMode(): CLUEMode {
  return fromString(hash.getProp('clue', 'E'));
}

/**
 * wrapper containing the current mode
 */
class ModeWrapper extends EventHandler {
  private _mode = defaultMode();

  constructor() {
    super();
    fire('clue.modeChanged', this._mode, this._mode);
  }

  set mode(value: CLUEMode) {
    if (this._mode === value) {
      return;
    }
    if (value.isAtomic) {
      //use the real atomic one for a shared instance
      value = fromString(value.toString());
    }
    const bak = this._mode;
    this._mode = value;
    //store in hash
    hash.setProp('clue', value.toString());
    this.fire('modeChanged', value, bak);
    fire('clue.modeChanged', value, bak);
  }

  get mode() {
    return this._mode;
  }
}
const _instance = new ModeWrapper();

export const on = ModeWrapper.prototype.on.bind(_instance);
export const off = ModeWrapper.prototype.off.bind(_instance);

/**
 * returns the current mode
 * @returns {CLUEMode}
 */
export function getMode() {
  return _instance.mode;
}
/**
 * set the mode
 * @param value
 */
export function setMode(value: CLUEMode) {
  _instance.mode = value;
}

/**
 * utility to select the mode using three buttons to the atomic versions using bootstrap buttons
 */
export class ButtonModeSelector {
  private options = {
    /**
     * button size, i.e. the class btn-{size] will be added
     */
    size: 'xs'
  };
  private readonly node: HTMLElement;

  constructor(parent: Element, options: any = {}) {
    mixin(this.options, options);
    this.node = this.build(parent);

    const listener = (event: IEvent, newMode: CLUEMode) => {
      this.node.dataset.mode = newMode.toString();
      Array.from(parent.lastElementChild!.querySelectorAll('label')).forEach((label: HTMLElement) => {
        const input = (<HTMLInputElement>label.firstElementChild!);
        const d = fromString(input.value);
        label.classList.toggle('active', d === newMode);
        input.checked = d === newMode;
      });
    };
    _instance.on('modeChanged', listener);
    onDOMNodeRemoved(this.node, () => {
      _instance.off('modeChanged', listener);
    });
  }

  private build(parent: Element) {
    parent.insertAdjacentHTML('beforeend', `<div class="clue_buttonmodeselector btn-group" data-toggle="buttons" data-mode="${getMode().toString()}">
        <label class="btn btn-${this.options.size} clue-${modes.Exploration.toString()}${modes.Exploration === getMode() ? ' active' : ''}">
           <input type="radio" name="clue_mode" autocomplete="off" value="${modes.Exploration.toString()}" ${modes.Exploration === getMode() ? 'checked="checked"' : ''}> ${i18next.t('phovea:clue.mode.exploration')}
        </label>
        <label class="btn btn-${this.options.size} clue-${modes.Authoring.toString()}${modes.Authoring === getMode() ? ' active' : ''}">
           <input type="radio" name="clue_mode" autocomplete="off" value="${modes.Authoring.toString()}" ${modes.Authoring === getMode() ? 'checked="checked"' : ''}> ${i18next.t('phovea:clue.mode.authoring')}
        </label>
        <label class="btn btn-${this.options.size} clue-${modes.Presentation.toString()}${modes.Presentation === getMode() ? ' active' : ''}">
            <input type="radio" name="clue_mode" autocomplete="off" value="${modes.Presentation.toString()}" ${modes.Presentation === getMode() ? 'checked="checked"' : ''}> ${i18next.t('phovea:clue.mode.presentation')}
        </label>
    </div>`);
    Array.from(parent.lastElementChild!.querySelectorAll('label')).forEach((label: HTMLElement) => {
      label.onclick = () => setMode(fromString((<HTMLInputElement>label.firstElementChild!).value));
    });
    return <HTMLElement>parent.lastElementChild!;
  }
}

// /**
//  * mode selector based on three sliders for each dimensions that are synced
//  */
// export class SliderModeSelector {
//   private options = {};
//   private $node:d3.Selection<SliderModeSelector>;
//
//   constructor(parent:Element, options:any = {}) {
//     mixin(this.options, options);
//     this.$node = d3.select(parent).append('div').classed('clue_modeselector', true).datum(this);
//     this.build(this.$node);
//
//     const listener = (event:IEvent, newMode:CLUEMode) => {
//       this.$node.select('label.clue-E input').property('value', Math.round(newMode.exploration * 100));
//       this.$node.select('label.clue-A input').property('value', Math.round(newMode.authoring * 100));
//       this.$node.select('label.clue-P input').property('value', Math.round(newMode.presentation * 100));
//     };
//     _instance.on('modeChanged', listener);
//     C.onDOMNodeRemoved(<Element>this.$node.node(), () => {
//       _instance.off('modeChanged', listener);
//     });
//   }
//
//   private build($parent:d3.Selection<any>) {
//     const $root = $parent.append('div').classed('clue_slidermodeselector', true);
//     const $modes = $root.selectAll('label').data([modes.Exploration, modes.Authoring, modes.Presentation]);
//
//     function normalize(eap:[number,number,number], drivenBy:number) {
//       const base = eap[drivenBy];
//       eap[drivenBy] = 0;
//       const factor = (1 - base) / eap.reduce((a,b) => a + b, 0);
//       eap = <[number,number,number]>eap.map((v) => v * factor);
//       eap[drivenBy] = base;
//       return eap;
//     }
//
//     function updateMode(drivenBy = -1) {
//       let e = parseFloat($modes.select('label.clue-E input').property('value')) / 100;
//       let a = parseFloat($modes.select('label.clue-A input').property('value')) / 100;
//       let p = parseFloat($modes.select('label.clue-P input').property('value')) / 100;
//       if (drivenBy >= 0) {
//         [e, a, p] = normalize([e, a, p], drivenBy);
//       }
//       setMode(mode(e, a, p));
//     }
//
//     $modes.enter().append('label')
//       .attr('class', (d) => 'clue-' + d.toString())
//       .text((d, i) => ['Exploration', 'Authoring', 'Presentation'][i])
//       .append('input')
//       .attr({
//         type: 'range',
//         min: 0,
//         max: 100,
//         value: (d, i) => getMode().value(i) * 100
//       }).on('input', (d, i) => {
//       updateMode(i);
//     });
//     return $root;
//   }
// }
//
// /**
//  * mode selector based on a triangle
//  */
// export class TriangleModeSelector {
//   private options = {
//     /**
//      * height of the triangle
//      */
//     height: 15,
//     /**
//      * offset bounds
//      */
//     offset: 5
//   };
//   private $node:d3.Selection<TriangleModeSelector>;
//
//   private e = [0, 30];
//   private a = [30, 0];
//   private p = [60, 30];
//
//   constructor(parent:Element, options:any = {}) {
//     mixin(this.options, options);
//     this.e[1] = this.a[0] = this.p[1] = this.options.height;
//     this.p[0] = this.options.height * 2;
//     this.$node = d3.select(parent).append('div').classed('clue_trianglemodeselector', true).datum(this);
//     this.build(this.$node);
//
//     const listener = (event:IEvent, newMode:CLUEMode) => {
//       const c = this.toCoordinates(newMode);
//       this.$node.select('circle.point').attr({
//         cx: c[0],
//         cy: c[1]
//       });
//     };
//     _instance.on('modeChanged', listener);
//     C.onDOMNodeRemoved(<Element>this.$node.node(), () => {
//       _instance.off('modeChanged', listener);
//     });
//   }
//
//   private toCoordinates(m:CLUEMode) {
//     const x = m.exploration * this.e[0] + m.authoring * this.a[0] + m.presentation * this.p[0];
//     const y = m.exploration * this.e[1] + m.authoring * this.a[1] + m.presentation * this.p[1];
//     return [x, y];
//   }
//
//   private fromCoordinates(x:number, y:number) {
//     //https://en.wikipedia.org/wiki/Barycentric_coordinate_system
//     const x1 = this.e[0], x2 = this.a[0], x3 = this.p[0], y1 = this.e[1], y2 = this.a[1], y3 = this.p[1];
//     let e = Math.max(0, Math.min(1, ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / ((y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3))));
//     let a = Math.max(0, Math.min(1, ((y3 - y3) * (x - x3) + (x1 - x3) * (y - y3)) / ((y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3))));
//     const s = e + a;
//     if (s > 1) {
//       e /= s;
//       a /= s;
//     }
//     const p = 1 - e - a;
//     return mode(e, a, p);
//   }
//
//   private build($parent:d3.Selection<any>) {
//     const $root = $parent.append('svg').classed('clue_trianglemodeselector', true).attr({
//       width: this.p[0] + this.options.offset,
//       height: this.p[1] + this.options.offset
//     });
//     const that = this;
//     const $g = $root.append('g').attr('transform', `translate(${this.options.offset / 2},${this.options.offset / 2})`);
//     $g.append('path').attr('d', d3.svg.line<number[]>().interpolate('linear-closed')([this.e, this.a, this.p])).on('click', function () {
//       const xy = d3.mouse(this);
//       const m = that.fromCoordinates(xy[0], xy[1]);
//       setMode(m);
//     });
//     const xy = this.toCoordinates(getMode());
//     $g.append('circle').classed('point', true).attr({
//       cx: xy[0],
//       cy: xy[1],
//       r: 2
//     }).call(d3.behavior.drag().on('drag', () => {
//       const m = this.fromCoordinates((<MouseEvent>d3.event).x, (<MouseEvent>d3.event).y);
//       setMode(m);
//     }));
//     return $root;
//   }
// }
//
// /**
//  * alias for `createTriangle`
//  * @param parent the parent dom element
//  * @param options
//  * @returns {TriangleModeSelector}
//  */
// export function create(parent:Element, options:any = {}) {
//   return createTriangle(parent, options);
// }
// export function createTriangle(parent:Element, options:any = {}) {
//   return new TriangleModeSelector(parent, options);
// }
export function createButton(parent: Element, options: any = {}) {
  return new ButtonModeSelector(parent, options);
}
//export function createSlider(parent:Element, options:any = {}) {
//  return new SliderModeSelector(parent, options);
//}
