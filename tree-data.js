/* ===========================================================================
   TAS DECISION TREE — CONTENT
   The single source of truth for what the tree asks and what it recommends.
   Loaded by both the tree (index.html) and the editor (admin.html).

   Precedence, lowest to highest:
     1. the copy bundled inside index.html   (so a standalone file still works)
     2. this file                            (what the repo ships)
     3. a draft saved from /admin            (localStorage, this browser only)

   Edit this by hand, or edit it visually at /admin and export over it.
   ========================================================================= */
(function(){
var NODES={
  q1:{tag:'Question 1 · Boundaries',short:'Boundaries',
    q:'Are any of the Tribe’s jurisdictional boundaries disputed?',
    a:[{label:'No — boundaries are clear',short:'No — clear',to:'q2'},
       {label:'Yes — some are disputed',short:'Yes — disputed',to:'q1b'},
       {label:'We’re not sure yet',short:'Not sure',to:'q1b'}]},
  q1b:{tag:'Question 1b · Boundary risk',short:'Boundary risk',risky:true,
    q:'How would you like to proceed?',
    note:'EPA must share your boundary showing with the appropriate governmental entities, who may comment and later challenge it in court. An adverse ruling could narrow the CAA regulatory jurisdiction EPA recognizes — it does not affect land title.',
    a:[{label:'Undisputed areas only',short:'Undisputed only',to:'q2'},
       {label:'Our full claimed area',short:'Full area',to:'q2'},
       {label:'Don’t pursue TAS now',short:'Don’t pursue',to:'END_NONTAS'}]},
  q2:{tag:'Question 2 · Sources',short:'Sources',
    q:'How many air-pollution sources are within your jurisdiction?',
    a:[{label:'Many',short:'Many',to:'q3',grants:'regulatory'},
       {label:'A few, or a local issue',short:'A few',to:'q3',grants:'targeted'},
       {label:'None or very few',short:'None/very few',to:'q3'}]},
  q3:{tag:'Question 3 · Good neighbour',short:'Good neighbour',
    q:'Do outside sources affect your air, or do you want a say in nearby permits?',
    a:[{label:'Yes',short:'Yes',to:'q4',grants:'participatory'},
       {label:'No',short:'No',to:'q4'}]},
  q4:{tag:'Question 4 · Capacity',short:'Capacity',
    q:'Do you have the capacity to run an air program?',
    a:[{label:'Yes, we’re ready',short:'Ready',to:'END'},
       {label:'Not yet — we’d build it',short:'Building',to:'END',grants:'capacity'},
       {label:'Unsure',short:'Unsure',to:'END',grants:'capacity'}]}
};
var OUT={
  regulatory:{name:'Regulatory TAS',title:'Be the primary implementing authority',
    body:'Develop and run the programs that permit, inspect and enforce on the sources in your jurisdiction. You choose <b>how</b>:',
    options:[{h:'Develop your own programs → EPA approval',d:'You tailor the rules and are the primary enforcer. Once approved they are federally enforceable.'},
             {h:'Take delegation of federal rules',d:'No rule-writing — use existing federal rules (40 CFR part 71). You permit and inspect; enforcement is referred to EPA. A good capacity-building first step.'}],
    sections:['§110 TIP','O₃ plans §§181–185','PM plans §§188–189','SO₂/NO₂/Pb §§191–192','CO plans §§186–187','Regional haze §169A','PSD §165','NSR §173','§167 enforcement','Title V §§501–507','§111 NSPS','§112 air toxics','§114 records','§129 solid-waste combustion','§303 emergency powers']},
  targeted:{name:'Targeted Regulatory TAS',title:'Address a specific, localized issue',
    body:'Even with only a few sources a focused program can help — for example a burning ordinance for wood smoke under a Tribal Implementation Plan.',
    sections:['§110 TIP','PM NAAQS']},
  participatory:{name:'Participatory TAS',title:'A formal “good neighbour” voice',
    body:'Get early review of, and standing to comment on, neighbouring states’ plans and permits — and petition EPA when outside sources affect your air.',
    sections:['§126(a)/(b)','§110(a)(2)(D)(i)','§505(a)','§105 grants','§319 monitoring','§107(d) designations']},
  capacity:{name:'Capacity building',title:'You can pursue TAS while you build capacity',
    body:'Not being “ready” is not a barrier. Options that lower the lift:',
    checks:[{h:'Submit a capability plan',d:'Show EPA how you will gain the technical expertise over time.'},
            {h:'Take delegation instead of writing rules',d:'Use federal rules under 40 CFR part 71 to start.'},
            {h:'Phase your program',d:'Seek TAS for a few sections now, add more later.'},
            {h:'Partner or form a consortium',d:'Share staff and expertise with neighbouring Tribes.'}]}
};
var NONTAS=[
  {h:'Use your inherent Tribal authority',d:'Develop your own programs without submitting them to EPA for approval.'},
  {h:'Grants',d:'§103 (investigative) grants need no TAS; §105 (programmatic) grants can flow through a Performance Partnership Grant (PPG). Note §105 without TAS carries the standard 40% match, whereas TAS reduces it to 5% (then up to 10%).'},
  {h:'Run programs directly',d:'Monitoring, environmental education, indoor-air and radon programs — all without TAS.'}
];
var CRITERIA=[
  {h:'Federal recognition',d:'Listed by the Department of the Interior. § 49.6(a)'},
  {h:'A governing body carrying out substantial duties',d:'A narrative on your government’s form, functions and source of authority. § 49.6(b)'},
  {h:'A jurisdictional showing',d:'Reservation: map + legal description of exterior boundaries. Off-reservation: a statement of legal counsel on the basis for jurisdiction. § 49.6(c)'},
  {h:'Reasonable capability — or a plan to build it',d:'§ 49.6(d). You may reuse documentation from a prior TAS approval per § 49.7(a)(8).'}
];
var NEXT=[
  {h:'Bring this result to Tribal leadership, Council and legal counsel.',d:'The boundary and sovereignty stakes make this a governance decision, not just a technical one.'},
  {h:'Assemble your jurisdictional showing.',d:'Map and legal description (reservation), or a counsel statement (off-reservation).'},
  {h:'Document your governing body and capability — or a plan to build it.',d:''},
  {h:'Contact your EPA Regional Office Tribal air lead (or OAQPS).',d:'They can confirm scope and help streamline the application.'},
  {h:'Review the detailed CAA-section summary before finalizing which sections to seek.',d:''}
];
var LINKS=[
  {t:'CAA: Summary of content & applicability for TAS (Titles I, III, V)',u:'https://www.epa.gov/tribal-air/clean-air-act-summary-content-applicability-tas-titles-i-iii-and-v'},
  {t:'Tribal Authority Rule (TAR) under the Clean Air Act',u:'https://www.epa.gov/tribal-air/tribal-authority-rule-tar-under-clean-air-act'}
];
var DISC='General information to support your discussion — not legal advice, and not an official EPA product. Confirm all citations against 40 CFR Part 49 and the current Clean Air Act, and consult Tribal legal counsel before applying.';

  var DATA={NODES:NODES,OUT:OUT,NONTAS:NONTAS,CRITERIA:CRITERIA,NEXT:NEXT,LINKS:LINKS,DISC:DISC};
  if(typeof window!=='undefined') window.TAS_TREE=DATA;
  if(typeof module!=='undefined'&&module.exports) module.exports=DATA;
})();
