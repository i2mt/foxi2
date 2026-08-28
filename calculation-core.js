/* Pure calculation helpers shared by the UI and smoke tests. */
(function (window) {
    'use strict';

    const UNIT_TO_MCG = { g: 1000000, mg: 1000, mcg: 1 };

    function baseUnit(unit) {
        return String(unit || '').trim().split('/')[0].toLowerCase();
    }

    function reverseInfusionDose(options) {
        const pumpRate = Number(options.pumpRate);
        const totalDrug = Number(options.totalDrug);
        const solutionVolume = Number(options.solutionVolume);
        const doseUnit = String(options.doseUnit || '');
        const drugUnit = baseUnit(options.drugUnit);
        const targetUnit = baseUnit(doseUnit);

        if (!(pumpRate > 0) || !(totalDrug > 0) || !(solutionVolume > 0)) {
            throw new Error('invalid-infusion-values');
        }

        let dosePerHour = pumpRate * (totalDrug / solutionVolume);
        if (drugUnit !== targetUnit) {
            if (!(drugUnit in UNIT_TO_MCG) || !(targetUnit in UNIT_TO_MCG)) {
                throw new Error('incompatible-dose-units');
            }
            dosePerHour = dosePerHour * UNIT_TO_MCG[drugUnit] / UNIT_TO_MCG[targetUnit];
        }

        let dose = doseUnit.toLowerCase().includes('/min') ? dosePerHour / 60 : dosePerHour;
        if (doseUnit.toLowerCase().includes('/kg')) {
            const weight = Number(options.weight);
            if (!(weight > 0)) throw new Error('weight-required');
            dose /= weight;
        }
        return dose;
    }

    window.FoxiCalcCore = Object.freeze({ reverseInfusionDose });
})(window);
