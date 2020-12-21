/**
 * Created by Holger Stitz on 09.08.2017.
 */
import { Property, PropertyType, TAG_VALUE_SEPARATOR } from 'phovea_core';
import * as d3 from 'd3';
export class PropertyModifier {
    constructor() {
        this._properties = [];
        this._searchResults = [];
        this._showActiveStateOnly = false;
        this.propertyLookup = new Map();
        this.idLookup = new Map();
        this.idCounter = new Map();
        //
    }
    addState(visState) {
        this.addStatesToLookup([visState]);
        this.modifyProperties();
    }
    get searchResults() {
        return this._searchResults;
    }
    set searchResults(value) {
        this._searchResults = value;
        this.generateSimilarResultProps(this._properties, this.searchResults, 10);
        this.modifyProperties();
    }
    get properties() {
        if (this.searchForStateProperty) {
            return [this.searchForStateProperty, ...this._properties];
        }
        else {
            return [...this._properties];
        }
    }
    set properties(value) {
        value.forEach((prop) => {
            const index = this._properties.findIndex((p) => p.text === prop.text);
            // replace if exists
            if (index > -1) {
                this._properties.splice(index, 1, prop);
                // add as last
            }
            else {
                this._properties.push(prop);
            }
        });
        this._properties.forEach((prop) => {
            prop.values.forEach((propVal) => {
                this.propertyLookup.set(propVal.baseId, prop);
            });
        });
        this.sortValuesAndAddCount(this._properties);
        this.modifyProperties();
    }
    get activeVisState() {
        return this._activeVisState;
    }
    set activeVisState(visState) {
        this._activeVisState = visState;
        this.modifyProperties();
    }
    get searchForStateProperty() {
        return this._searchForStateProperty;
    }
    set searchForStateProperty(property) {
        this._searchForStateProperty = property;
        if (this._searchForStateProperty) {
            this._searchForStateProperty.values = this._searchForStateProperty.values
                .map((d) => d.clone())
                .map((d) => {
                if (this.propertyLookup.has(d.baseId)) {
                    if (!d.payload) {
                        d.payload = {};
                    }
                    d.payload.propText = this.propertyLookup.get(d.baseId).text;
                }
                return d;
            });
            this.sortValuesAndAddCount([this._searchForStateProperty]);
            this.updatePropertyValues([this._searchForStateProperty]);
        }
    }
    get showActiveStateOnly() {
        return this._showActiveStateOnly;
    }
    set showActiveStateOnly(value) {
        this._showActiveStateOnly = value;
        this.updatePropertyValues(this._properties);
    }
    addStatesToLookup(visStates) {
        visStates
            .filter((s) => s !== undefined || s !== null)
            .map((s) => s.propValues)
            .map((propVals) => {
            const terms = propVals.map((p) => PropertyModifier.getPropId(p));
            const uniqueTerms = Array.from(new Set(terms));
            uniqueTerms.forEach((t) => {
                const counter = (this.idCounter.has(t)) ? this.idCounter.get(t) : 0;
                this.idCounter.set(t, counter + 1);
            });
            return propVals;
        })
            .reduce((prev, curr) => prev.concat(curr), []) // flatten the array
            .forEach((p) => {
            const id = PropertyModifier.getPropId(p);
            // filter None values
            if (id === 'None') {
                return;
            }
            this.idLookup.set(id, p);
            this.idLookup.set(p.baseId, p); // add baseId for correct disabled setting
        });
        this.sortValuesAndAddCount(this._properties);
    }
    sortValuesAndAddCount(properties) {
        properties.forEach((prop) => {
            prop.values = prop.values
                .map((propVal) => {
                const id = PropertyModifier.getPropId(propVal);
                propVal.numCount = (this.idCounter.has(id)) ? this.idCounter.get(id) : 0; // undefined = count of 0
                return propVal;
            })
                .sort((a, b) => b.numCount - a.numCount); // desc
        });
    }
    modifyProperties() {
        if (this._properties.length === 0) {
            return;
        }
        this.generateTopProperties(this._properties, this.idCounter, this.idLookup, 10);
        this.updatePropertyValues(this._properties);
    }
    updatePropertyValues(properties) {
        properties.map((property) => {
            property.values.map((propVal) => {
                // important: mutable action (modifies original property data)
                this.updateActive(propVal);
                this.updateDisabled(propVal);
                this.updateVisibility(propVal);
                return propVal;
            });
            return property;
        });
    }
    generateTopProperties(properties, idCounter, idLookup, numTop = 10, propText = `Top ${numTop}`) {
        const vals = Array.from(idCounter.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, numTop)
            .map((d) => idLookup.get(d[0]))
            .filter((d) => d !== undefined)
            .map((d) => d.clone())
            .map((d) => {
            if (this.propertyLookup.has(d.baseId)) {
                if (!d.payload) {
                    d.payload = {};
                }
                d.payload.propText = this.propertyLookup.get(d.baseId).text;
            }
            return d;
        });
        const topProperties = new Property(PropertyType.SET, propText, vals);
        topProperties.values = topProperties.values
            .map((propVal) => {
            const id = PropertyModifier.getPropId(propVal);
            propVal.numCount = (idCounter.has(id)) ? idCounter.get(id) : 0; // undefined = count of 0
            return propVal;
        });
        const index = properties.findIndex((p) => p.text === topProperties.text);
        // replace if exists
        if (index > -1) {
            properties.splice(index, 1, topProperties);
            // add as first
        }
        else {
            properties.unshift(topProperties);
        }
    }
    generateSimilarResultProps(properties, results, numTop = 10) {
        const propText = `Related Search Terms`;
        const index = properties.findIndex((p) => p.text === propText);
        if (results.length === 0) {
            // remove existing element
            if (index > -1) {
                properties.splice(index, 1);
            }
            return;
        }
        const queryPropVals = results[0].query.propValues;
        const idLookup = new Map();
        const idCounter = new Map();
        results
            .map((r) => r.state.propValues)
            .map((propVals) => {
            const terms = propVals.map((p) => PropertyModifier.getPropId(p));
            const uniqueTerms = Array.from(new Set(terms));
            uniqueTerms.forEach((t) => {
                const counter = (idCounter.has(t)) ? idCounter.get(t) : 0;
                idCounter.set(t, counter + 1);
            });
            return propVals;
        })
            .reduce((prev, curr) => prev.concat(curr), []) // flatten the  array
            .filter((p) => !queryPropVals.find((qp) => qp.id === p.id)) // qp.baseId === p.baseId
            .forEach((p) => {
            const id = PropertyModifier.getPropId(p);
            // filter None values
            if (id === 'None') {
                return;
            }
            idLookup.set(id, p);
            idLookup.set(p.baseId, p); // add baseId for correct disabled setting
        });
        this.generateTopProperties(properties, idCounter, idLookup, numTop, propText);
    }
    updateDisabled(propVal) {
        // important: mutable action (modifies original property data)
        propVal.isDisabled = !this.idLookup.has(propVal.baseId);
    }
    updateActive(propVal) {
        if (!this.activeVisState || !this.activeVisState.propValues) {
            return;
        }
        // important: mutable action (modifies original property data)
        propVal.isActive = (this.activeVisState.propValues.filter((p) => PropertyModifier.getPropId(propVal) === PropertyModifier.getPropId(p)).length > 0);
    }
    updateVisibility(propVal) {
        // important: mutable action (modifies original property data)
        propVal.isVisible = (this.showActiveStateOnly) ? (propVal.isActive) : true;
    }
    static getPropId(propVal) {
        // use p.text for numerical properties to consider the numVal and distinguish between `skinny = 0.21` and `skinny = 0.22`
        return (propVal.type === PropertyType.NUMERICAL && propVal.payload) ? `${propVal.baseId} ${TAG_VALUE_SEPARATOR} ${d3.round(propVal.payload.numVal, 2)}` : propVal.id;
    }
}
//# sourceMappingURL=PropertyModifier.js.map