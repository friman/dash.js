/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
import ThroughputRule from './ThroughputRule';
import InsufficientBufferRule from './InsufficientBufferRule';
import AbandonRequestsRule from './AbandonRequestsRule';
import DroppedFramesRule from './DroppedFramesRule.js';
import SwitchHistoryRule from './SwitchHistoryRule.js';
import BolaRule from './BolaRule';
import BolaAbandonRule from './BolaAbandonRule';
import FactoryMaker from '../../../core/FactoryMaker';
import SwitchRequest from '../SwitchRequest.js';

const QUALITY_SWITCH_RULES = 'qualitySwitchRules';
const ABANDON_FRAGMENT_RULES = 'abandonFragmentRules';

function ABRRulesCollection(config) {

    let context = this.context;

    const mediaPlayerModel = config.mediaPlayerModel;
    const metricsModel = config.metricsModel;
    const dashMetrics = config.dashMetrics;
    const adapter = config.adapter;

    let instance,
        qualitySwitchRules,
        abandonFragmentRules;

    function initialize() {
        qualitySwitchRules = [];
        abandonFragmentRules = [];

        if (mediaPlayerModel.getUseDefaultABRRules()) {
            if (mediaPlayerModel.getBufferOccupancyABREnabled()) {
                qualitySwitchRules.push(
                    BolaRule(context).create({
                        metricsModel: metricsModel,
                        dashMetrics: dashMetrics,
                        mediaPlayerModel: mediaPlayerModel,
                        adapter: adapter
                    })
                );

                abandonFragmentRules.push(
                    BolaAbandonRule(context).create({
                        metricsModel: metricsModel,
                        dashMetrics: dashMetrics
                    })
                );
            } else {
                qualitySwitchRules.push(
                    ThroughputRule(context).create({
                        metricsModel: metricsModel,
                        dashMetrics: dashMetrics
                    })
                );
                qualitySwitchRules.push(
                    InsufficientBufferRule(context).create({
                        metricsModel: metricsModel,
                        dashMetrics: dashMetrics
                    })
                );
                qualitySwitchRules.push(
                    SwitchHistoryRule(context).create()
                );
                qualitySwitchRules.push(
                    DroppedFramesRule(context).create()
                );

                abandonFragmentRules.push(
                    AbandonRequestsRule(context).create({
                        metricsModel: metricsModel,
                        dashMetrics: dashMetrics,
                        mediaPlayerModel: mediaPlayerModel
                    })
                );
            }
        }

        // add custom ABR rules if any
        let customRules = mediaPlayerModel.getABRCustomRules();
        customRules.forEach(function (rule) {
            if (rule.type === QUALITY_SWITCH_RULES) {
                qualitySwitchRules.push(rule.rule(context).create());
            }

            if (rule.type === ABANDON_FRAGMENT_RULES) {
                abandonFragmentRules.push(rule.rule(context).create());
            }
        });
    }

    function getActiveRules(srArray) {
        return srArray.filter(sr => sr.quality > SwitchRequest.NO_CHANGE);
    }

    function getMinSwitchRequest(srArray) {

        let values = {};
        let i,
            len,
            req,
            newQuality,
            quality;

        if (srArray.length === 0) {
            return;
        }

        values[SwitchRequest.PRIORITY.STRONG] = SwitchRequest.NO_CHANGE;
        values[SwitchRequest.PRIORITY.WEAK] = SwitchRequest.NO_CHANGE;
        values[SwitchRequest.PRIORITY.DEFAULT] = SwitchRequest.NO_CHANGE;

        for (i = 0, len = srArray.length; i < len; i += 1) {
            req = srArray[i];
            if (req.quality !== SwitchRequest.NO_CHANGE) {
                values[req.priority] = values[req.priority] > SwitchRequest.NO_CHANGE ? Math.min(values[req.priority], req.quality) : req.quality;
            }
        }

        if (values[SwitchRequest.PRIORITY.WEAK] !== SwitchRequest.NO_CHANGE) {
            newQuality = values[SwitchRequest.PRIORITY.WEAK];
        }

        if (values[SwitchRequest.PRIORITY.DEFAULT] !== SwitchRequest.NO_CHANGE) {
            newQuality = values[SwitchRequest.PRIORITY.DEFAULT];
        }

        if (values[SwitchRequest.PRIORITY.STRONG] !== SwitchRequest.NO_CHANGE) {
            newQuality = values[SwitchRequest.PRIORITY.STRONG];
        }

        if (newQuality !== SwitchRequest.NO_CHANGE) {
            quality = newQuality;
        }

        return SwitchRequest(context).create(quality);
    }

    function getMaxQuality(rulesContext) {
        let switchRequestArray = qualitySwitchRules.map(rule => rule.getMaxIndex(rulesContext));
        let activeRules = getActiveRules(switchRequestArray);
        let maxQuality = getMinSwitchRequest(activeRules);

        return maxQuality || SwitchRequest(context).create();
    }

    function shouldAbandonFragment(rulesContext) {
        let abandonRequestArray = abandonFragmentRules.map(rule => rule.shouldAbandon(rulesContext));
        let activeRules = getActiveRules(abandonRequestArray);
        let shouldAbandon = getMinSwitchRequest(activeRules);

        return shouldAbandon || SwitchRequest(context).create();
    }

    function reset() {
        [qualitySwitchRules, abandonFragmentRules].forEach(rules => {
            if (rules && rules.length) {
                rules.forEach(rule => rule.reset && rule.reset());
            }
        });
        qualitySwitchRules = [];
        abandonFragmentRules = [];
    }

    instance = {
        initialize: initialize,
        reset: reset,
        getMaxQuality: getMaxQuality,
        shouldAbandonFragment: shouldAbandonFragment
    };

    return instance;
}

ABRRulesCollection.__dashjs_factory_name = 'ABRRulesCollection';
let factory = FactoryMaker.getClassFactory(ABRRulesCollection);
factory.QUALITY_SWITCH_RULES = QUALITY_SWITCH_RULES;
factory.ABANDON_FRAGMENT_RULES = ABANDON_FRAGMENT_RULES;
FactoryMaker.updateSingletonFactory(ABRRulesCollection.__dashjs_factory_name, factory);

export default factory;
