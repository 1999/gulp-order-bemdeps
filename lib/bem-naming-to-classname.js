'use strict';

export default function BEMNamingToClassname(bemNaming) {
    let output = bemNaming.block;

    if (bemNaming.mod) {
        output += `_${bemNaming.mod}`;
    }

    if (bemNaming.modVal) {
        output += `_${bemNaming.modVal}`;
    }

    if (bemNaming.elem) {
        output += `__${bemNaming.elem}`;
    }

    if (bemNaming.elemMod) {
        output += `_${bemNaming.elemMod}`;
    }

    if (bemNaming.elemModVal) {
        output += `_${bemNaming.elemModVal}`;
    }

    return output;
};
