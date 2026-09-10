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
    note:'A TAS request needs a jurisdictional showing. EPA notifies the appropriate governmental entities — including neighbouring state and local air agencies — and gives them a period to comment on it, and after an approval EPA\u2019s determination and its jurisdictional basis can be challenged in court. An adverse ruling could narrow the Clean Air Act regulatory jurisdiction EPA recognizes for the Tribe. It does not affect land title or ownership \u2014 those are separate questions. The full note is in your result.',
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
/* Disclaimers, by placement. Seven, because they do different jobs — the
   standing bar is one line the reader never loses; the printout has to stand
   alone months later with none of the tool around it. Edit at /admin.
   NOTE: the guide copy in index.html quotes the pathway names and the result
   panel’s running order. Rename a pathway below or in OUT and the guide goes
   out of date with it — the editor cannot warn about that. */
var DISC={
  bar:`General information to support your discussion — not legal advice, and not an official EPA product. Confirm with Tribal legal counsel.`,
  guide:`<p>This is not an official EPA product, carries no EPA endorsement, and is not legal advice. It does not determine eligibility and it sends nothing to EPA. What you get at the end is a written summary of the route you chose — something to open a conversation with Tribal legal counsel, with leadership and Council, and with your EPA Regional Office Tribal air lead.</p><p>Every answer is one you select yourself. The tool cannot verify anything about your boundaries, your sources or your capacity, so a result is only as sound as what was entered. Read it as one input into a governance decision, not as the decision.</p>`,
  boundary:`<p>A TAS request requires a jurisdictional showing — for a reservation, a map and legal description of the exterior boundaries; for off-reservation areas, a statement of legal counsel on the basis for jurisdiction (<code>40 CFR §49.7</code>). EPA notifies the appropriate governmental entities, including neighbouring state and local air agencies, and gives them a period to comment on the Tribe's jurisdictional assertion (<code>40 CFR §49.9</code>). After an approval, EPA's determination and the jurisdictional basis for it can be challenged in court.</p><p>If such a challenge succeeded, the effect would be to <b>narrow the Clean Air Act regulatory jurisdiction EPA recognizes</b> for the Tribe — a limit on the area over which the Tribe could implement and enforce CAA programs. It does <b>not</b> affect land title or ownership. Nothing in a TAS proceeding changes who holds or owns the land; the two are separate questions and should not be described to Council as one.</p><p>Neither comment nor a court challenge is automatic. But the showing is open to others, so the possibility belongs in the decision before you file. Which areas to request — the full claimed area, or undisputed areas only — is a judgement for Tribal legal counsel and Council.</p>`,
  authority:`<p>TAS is a threshold status. An approval means EPA recognizes the Tribe as eligible for treatment in the same manner as a state for the Clean Air Act sections named in the request. It does not, by itself, put a program in place or give the Tribe authority to permit, inspect or enforce.</p><p>Each program must then be submitted to EPA separately and approved before the Tribe can implement or enforce it — a Tribal implementation plan under <code>§110</code>, a title V operating-permit program, delegation of the federal rules at <code>40 CFR Part 71</code>, and so on. Until that second step is complete for a given program, EPA remains the implementing authority. Plan for both stages, and for the time between them.</p>`,
  result:`<p>This result reflects only the answers selected here. It is general information to support your discussion — not legal advice, not a determination of eligibility, and not an official EPA product. Nothing has been sent to EPA.</p><p>Before anyone relies on it: confirm every section number against the current Clean Air Act and <code>40 CFR Part 49</code>, review the sections with Tribal legal counsel, and speak with your EPA Regional Office Tribal air lead.</p>`,
  print:`<p>This document was produced by the TAS Decision Tree, an unofficial planning aid. It is not an EPA product, carries no EPA endorsement or approval, and is not legal advice. It records the answers someone selected in the tool on the date it was generated, and the options those answers point to. Nothing in it has been reviewed by, filed with, or decided by EPA, and it is not an application.</p><p>If you are reading it some time later, treat it as a snapshot: the Clean Air Act, <code>40 CFR Part 49</code>, EPA guidance and the Tribe's own circumstances may all have changed. Confirm every section number against the current statute and regulation, and read it with Tribal legal counsel.</p><p>Two points are easy to lose without the rest of the tool in front of you:</p><ul><li>TAS is a threshold eligibility status. Each program must still be submitted to EPA separately and approved before the Tribe can implement or enforce it.</li><li>If the route recorded here involved a disputed or uncertain boundary: a TAS request requires a jurisdictional showing, EPA notifies the appropriate governmental entities, they may comment on the Tribe's jurisdictional assertion, and after an approval EPA's determination and its jurisdictional basis can be challenged in court. An adverse ruling could narrow the Clean Air Act regulatory jurisdiction EPA recognizes for the Tribe. It would <b>not</b> affect land title or ownership.</li></ul><p>Questions about scope or eligibility go to your EPA Regional Office Tribal air lead.</p>`,
  cites:`<p>The section numbers here — Clean Air Act sections such as <code>§110</code>, <code>§126</code> and <code>§505(a)</code>, the eligibility criteria at <code>40 CFR §49.6</code>, the contents of a request at <code>§49.7</code>, and the provisions Part 49 does not open to Tribes at <code>§49.4</code> — point you to the right part of the law. They are not authority to quote. Statutes, regulations and guidance change, and this tool is not updated automatically.</p><p>Confirm each cite against the current Clean Air Act and <code>40 CFR Part 49</code> before it goes into a request, a Council briefing, or anything else people will act on. Tribal legal counsel and your EPA Regional Office Tribal air lead can confirm which sections apply to what you intend to seek.</p>`
};
/* Who a reader reaches from the Contact panel. Blank in the repo on purpose:
   the panel says plainly that these are not set yet rather than inventing a
   person. `calendly` takes the Calendly link for the event people should
   book: it embeds in the Contact panel and carries the reader's question
   into it as a prefill. Another scheduling service still works as a link. */
var CONTACT={name:'',role:'',email:'',phone:'',calendly:''};

  var DATA={NODES:NODES,OUT:OUT,NONTAS:NONTAS,CRITERIA:CRITERIA,NEXT:NEXT,LINKS:LINKS,
            DISC:DISC,CONTACT:CONTACT};
  if(typeof window!=='undefined') window.TAS_TREE=DATA;
  if(typeof module!=='undefined'&&module.exports) module.exports=DATA;
})();
