import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSON, validateLesson } from '../src/domain/lesson.js';
import { incomingEnergyForSeed, modelRuleVectors, simulateChoice, simulateExperiment } from '../src/domain/simulation.js';
import { createLabState, reduceLab, snapshot, LabRuleError, MAX_PREDICTIONS_PER_CYCLE } from '../src/domain/lab-engine.js';

const at = (state, type, now, details = {}) => reduceLab(state, { type, now, ...details });
test('versioned lesson is bounded, exact-command, and source-host validated', () => {
  assert.equal(validateLesson(LESSON), true);
  assert.equal(LESSON.inputContract.freeTextAccepted, false);
  assert.deepEqual(LESSON.inputContract.commands, ['!predict 1','!predict 2','!predict 3']);
  assert.ok(LESSON.moderationExamples.safe.length && LESSON.moderationExamples.outOfScope.length);
  assert.equal(LESSON.expectedOutputs.goldenVectors.length, 3);
  assert.throws(() => validateLesson({ ...LESSON, source: { ...LESSON.source, url: 'http://science.nasa.gov/test' } }));
});

test('seeded model matches documented golden outputs, conserves units, and lower albedo absorbs more', () => {
  for (const vector of modelRuleVectors()) assert.equal(vector.absorbed + vector.reflected, vector.incoming);
  for (const golden of LESSON.expectedOutputs.goldenVectors) {
    assert.equal(incomingEnergyForSeed(golden.seed),golden.incomingEnergy);
    for (const expected of golden.results) assert.deepEqual(simulateChoice({seed:golden.seed,choiceId:expected.choiceId}),{choiceId:expected.choiceId,albedoPercent:LESSON.choices.find((choice)=>choice.id===expected.choiceId).albedoPercent,incomingEnergy:golden.incomingEnergy,absorbedEnergy:expected.absorbedEnergy,reflectedEnergy:expected.reflectedEnergy,unit:LESSON.expectedOutputs.unit});
  }
  for (const seed of ['fixture-a','fixture-b','same-seed']) {
    assert.equal(incomingEnergyForSeed(seed), incomingEnergyForSeed(seed));
    const outputs = LESSON.choices.map((choice) => simulateChoice({ seed, choiceId: choice.id }));
    assert.deepEqual(outputs.map((item) => item.albedoPercent), [20,50,80]);
    assert.ok(outputs[0].absorbedEnergy > outputs[1].absorbedEnergy);
    assert.ok(outputs[1].absorbedEnergy > outputs[2].absorbedEnergy);
    assert.deepEqual(simulateExperiment({ seed, choiceId: LESSON.choices[0].id }), simulateExperiment({ seed, choiceId: LESSON.choices[0].id }));
  }
  assert.throws(() => simulateChoice({ seed: 'x', choiceId: 'other' }), RangeError);
  assert.throws(() => incomingEnergyForSeed(''), TypeError);
});

test('controlled loop records plurality, hides result until reveal, and retains replay notes', () => {
  let state = createLabState({ id:'test-session',mode:'demo',seed:'repeatable-seed',now:1000 });
  state = at(state,'START_PREDICTIONS',1000);
  state = at(state,'PREDICTION_ACCEPTED',1100,{cycle:state.cycle,source:'demo',choiceId:LESSON.choices[1].id});
  state = at(state,'PREDICTION_ACCEPTED',1200,{cycle:state.cycle,source:'demo',choiceId:LESSON.choices[1].id});
  state = at(state,'CLOSE_PREDICTIONS',1300);
  assert.equal(state.phase,'choose'); assert.equal(state.predictionResult,'plurality'); assert.equal(state.selectedChoiceId,LESSON.choices[1].id);
  const audience = snapshot(state,{now:1300}); assert.equal(audience.selectedChoiceId,null); assert.equal(audience.result,null); assert.equal(audience.seed,undefined);
  const operator = snapshot(state,{now:1300,operator:true}); assert.equal(operator.seed,'repeatable-seed');
  state = at(state,'SELECT_PARAMETER',1400,{choiceId:LESSON.choices[0].id});
  state = at(state,'RUN_EXPERIMENT',1500);
  assert.equal(snapshot(state,{now:1500}).result,null);
  state = at(state,'REVEAL_RESULT',1600);
  assert.equal(snapshot(state,{now:1600}).result.tested.choiceId,LESSON.choices[0].id);
  assert.match(snapshot(state,{now:1600}).assumptionSummary,/illustrative/);
  const priorRuns = state.runs.length; state = at(state,'REPLAY',1700);
  assert.equal(state.phase,'ready'); assert.equal(state.runs.length,priorRuns); assert.equal(state.seed,'repeatable-seed');
});

test('prediction intake is hard-bounded per cycle even if callers bypass the demo fixture UI', () => {
  let state=createLabState({id:'cap-session',seed:'seed',now:0});state=at(state,'START_PREDICTIONS',1);
  for(let index=0;index<MAX_PREDICTIONS_PER_CYCLE;index++)state=at(state,'PREDICTION_ACCEPTED',index+2,{cycle:1,source:'demo',choiceId:LESSON.choices[index%LESSON.choices.length].id});
  assert.equal(state.predictionTotal,MAX_PREDICTIONS_PER_CYCLE);
  assert.throws(()=>at(state,'PREDICTION_ACCEPTED',600,{cycle:1,source:'demo',choiceId:LESSON.choices[0].id}),(error)=>error.code==='PREDICTION_LIMIT');
});

test('tie and no-vote paths are neutral and never silently select a condition', () => {
  let state=createLabState({id:'tie-session',seed:'seed',now:0}); state=at(state,'START_PREDICTIONS',0);
  state=at(state,'PREDICTION_ACCEPTED',1,{cycle:1,source:'demo',choiceId:LESSON.choices[0].id});
  state=at(state,'PREDICTION_ACCEPTED',2,{cycle:1,source:'demo',choiceId:LESSON.choices[1].id});
  state=at(state,'CLOSE_PREDICTIONS',3); assert.equal(state.predictionResult,'tie'); assert.equal(state.selectedChoiceId,null);
  state=at(state,'RESET',4); state=at(state,'START_PREDICTIONS',5); state=at(state,'CLOSE_PREDICTIONS',6);
  assert.equal(state.predictionResult,'no-votes'); assert.equal(state.selectedChoiceId,null);
});

test('phase transitions enforce deadlines, stale-cycle rejection, pause/resume, and closed state', () => {
  let state=createLabState({id:'phase-session',seed:'seed',now:0}); state=at(state,'START_PREDICTIONS',100);
  assert.throws(()=>at(state,'PREDICTION_ACCEPTED',100+LESSON.predictionWindowMs,{cycle:1,source:'demo',choiceId:LESSON.choices[0].id}), (e)=>e instanceof LabRuleError&&e.code==='PREDICTION_CLOSED');
  assert.throws(()=>at(state,'PREDICTION_ACCEPTED',101,{cycle:0,source:'demo',choiceId:LESSON.choices[0].id}), (e)=>e.code==='STALE_CYCLE');
  state=at(state,'PAUSE',200); const remaining=state.pausedRemainingMs; state=at(state,'RESUME',10_000);
  assert.equal(state.phase,'predict'); assert.equal(state.deadlineAt,10_000+remaining);
  state=at(state,'END_SESSION',10_001); assert.equal(state.phase,'closed');
  assert.throws(()=>at(state,'RESET',10_002),(e)=>e.code==='SESSION_CLOSED');
});
