/**
 * Created by sam on 10.02.2015.
 */

import * as idtypes from 'phovea_core/src/idtype';
import * as events from 'phovea_core/src/event';
import * as provenance from 'phovea_core/src/provenance';
import * as C from 'phovea_core/src/index';
import * as ranges from 'phovea_core/src/range';
import {lastOnly} from './compress';
import {resolveImmediately} from 'phovea_core/src';

const disabler = new events.EventHandler();


export function select(inputs:provenance.IObjectRef<any>[], parameter:any, graph, within):provenance.ICmdResult {
  const idtype = idtypes.resolve(parameter.idtype),
    range = ranges.parse(parameter.range),
    type = parameter.type;
  const bak = parameter.old ? ranges.parse(parameter.old) : idtype.selections(type);

  if (C.hash.has('debug')) {
    console.log('select', range.toString());
  }
  disabler.fire('disable-'+idtype.id);
  idtype.select(type, range);
  disabler.fire('enable-'+idtype.id);

  return createSelection(idtype, type, bak, range, parameter.animated).then((cmd) => ({ inverse: cmd, consumed : parameter.animated ? within : 0 }));
}

function meta(idtype:idtypes.IDType, type:string, range:ranges.Range, old:ranges.Range) {
  const l = range.dim(0).length;
  let promise;

  if (l === 0) {
    promise = resolveImmediately(`No ${idtype.names} Selected`);
  } else if (l === 1) {
    promise = idtype.unmap(range).then((r) => {
      return `Selected ${r[0]}`;
    });
  } else {
    promise = Promise.all([idtype.unmap(range.without(old)), idtype.unmap(old.without(range))]).then((names) => {
      // name select/deselect <item>, since the previously added item remains unclear
      const name = (names[0].length > 0) ? 'Selected ' + names[0][0] : 'Deselected ' + names[1][0];
      return `${name} (${l} ${idtype.names})`;
    });
  }
  return promise.then((title) => {
    return provenance.meta(title, provenance.cat.selection);
  });
}

/**
 * create a selection command
 * @param idtype
 * @param type
 * @param range
 * @param old optional the old selection for inversion
 * @returns {Cmd}
 */
export function createSelection(idtype:idtypes.IDType, type:string, range:ranges.Range, old:ranges.Range = null, animated = false) {
  return meta(idtype, type, range, old).then((meta) => {
    return {
      meta,
      id: 'select',
      f: select,
      parameter: {
        idtype: idtype.id,
        range: range.toString(),
        type,
        old: old.toString(),
        animated
      }
    };
  });
}

export function compressSelection(path: provenance.ActionNode[]) {
  return lastOnly(path, 'select', (p) => p.parameter.idtype + '@' + p.parameter.type);
}

/**
 * utility class to record all the selections within the provenance graph for a specific idtype
 */
class SelectionTypeRecorder {
  private l = (event, type, sel, added, removed, old) => {
    createSelection(this.idtype, type, sel, old, this.options.animated).then((cmd) => this.graph.push(cmd));
  }

  private _enable = this.enable.bind(this);
  private _disable = this.disable.bind(this);

  private typeRecorders = [];

  constructor(private idtype:idtypes.IDType, private graph:provenance.ProvenanceGraph, private type?:string, private options : any = {}) {

    if (this.type) {
      this.typeRecorders = this.type.split(',').map((ttype) => {
        const t = (event, sel, added, removed, old) => {
          return this.l(event, ttype, sel, added, removed, old);
        };
        return t;
      });
    }
    this.enable();

    disabler.on('enable-'+this.idtype.id, this._enable);
    disabler.on('disable-'+this.idtype.id, this._disable);
  }

  disable() {
    if (this.type) {
      this.type.split(',').forEach((ttype, i) => {
        this.idtype.off('select-' + ttype, this.typeRecorders[i]);
      });
    } else {
      this.idtype.off('select', this.l);
    }
  }

  enable() {
    if (this.type) {
      this.type.split(',').forEach((ttype, i) => {
        this.idtype.on('select-' + ttype, this.typeRecorders[i]);
      });
    } else {
      this.idtype.on('select', this.l);
    }
  }

  destroy() {
    this.disable();
    disabler.off('enable-'+this.idtype.id, this._enable);
    disabler.off('disable-'+this.idtype.id, this._disable);
  }
}
/**
 * utility class to record all the selections within the provenance graph
 */
export class SelectionRecorder {
  private handler:SelectionTypeRecorder[] = [];
  private adder = (event, idtype) => {
    if (this.options.filter(idtype)) {
      this.handler.push(new SelectionTypeRecorder(idtype, this.graph, this.type, this.options));
    }
  }

  constructor(private graph:provenance.ProvenanceGraph, private type?:string, private options : any = {}) {
    this.options = C.mixin({
      filter: C.constantTrue,
      animated: false
    }, this.options);
    events.on('register.idtype', this.adder);
    idtypes.list().forEach((d) => {
      this.adder(null, d);
    });
  }

  destroy() {
    events.off('register.idtype', this.adder);
    this.handler.forEach((h) => h.destroy());
    this.handler.length = 0;
  }
}


export function create(graph:provenance.ProvenanceGraph, type?:string, options: any = {}) {
  return new SelectionRecorder(graph, type, options);
}
