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
/* Links the reviewer's wording calls for, written once. "contact us" opens the
   Contact panel from anywhere it appears, tree or result; the Peacock memo is
   EPA's "Strategy for Reviewing Tribal Eligibility Applications to Administer
   EPA Regulatory Programs" (Deputy Administrator Marcus Peacock, 23 January
   2008), the policy on what a Tribe must show about capacity, and when.
   An export from /admin writes these out as literal strings, which is fine. */
var PEACOCK='<a href="https://www.epa.gov/tribal/strategy-reviewing-tribal-eligibility-applications-administer-epa-regulatory-programs" target="_blank" rel="noopener">Peacock memo</a>';
var CONTACT_US='<a href="#" data-open-contact>contact us</a>';

/* Said of the undisputed-only route in two places — on the option in the tree
   and in the full result — so it is written once. */
var UNDISPUTED='The Tribe may develop a TAS request for only the undisputed areas; however, the Tribe should include a statement that says something like: “The Tribe is not including [describe the disputed area] at this time but may add this area in future.” Please discuss the appropriate language with your Tribal lawyers and leadership.';

/* The boundary question is asked from two answers now, and says something
   different to each: a Tribe that knows a boundary is disputed is warned about
   the risk of asserting it; a Tribe that is not sure yet is pointed at training
   first. Same question, same three ways forward, two notes. */
var BOUNDARY_OPTIONS=function(){
  return [{label:'Undisputed areas only',short:'Undisputed only',to:'q2',
           note:UNDISPUTED,detail:'<p>'+UNDISPUTED+'</p>'},
          {label:'Our full jurisdictional boundaries',short:'Full boundaries',to:'q2',
           detail:'<p>You chose to proceed over your <b>full jurisdictional boundaries</b> \u2014 have your Tribal lawyers prepare for a possible challenge.</p>'},
          {label:'Don\u2019t pursue TAS now',short:'Don\u2019t pursue',to:'END_NONTAS'}];
};

var NODES={
  q1:{tag:'Question 1 · Boundaries',short:'Boundaries',
    q:'Are any of the Tribe’s jurisdictional boundaries disputed?',
    a:[{label:'No — boundaries are clear',short:'No — clear',to:'q2'},
       {label:'Yes — some are disputed',short:'Yes — disputed',to:'q1b'},
       {label:'We’re not sure yet',short:'Not sure',to:'q1c'}]},
  q1b:{tag:'Question 1b · Boundary risk',short:'Boundary risk',risky:true,
    q:'How would you like to proceed?',
    note:'A TAS decision requires documentation of the jurisdiction for which the Tribe is requesting TAS. The EPA must notify and request comment on the Tribe\u2019s jurisdictional boundaries from the surrounding \u201caffected government entities,\u201d including the surrounding state and local air agencies. EPA\u2019s approval is a final Agency action and thus subject to judicial challenge. An adverse ruling could impact the Tribe\u2019s jurisdictional boundaries, including loss of Tribal lands! Please consider carefully the potential risk of asserting jurisdiction in disputed areas. It is imperative to include Tribal lawyers and leadership in any decision to move forward! Please feel free to contact us and your EPA project officer as you consider the appropriate option for your Tribe.',
    a:BOUNDARY_OPTIONS()},
  q1c:{tag:'Question 1b \u00b7 Boundary risk',short:'Boundary risk',risky:true,
    q:'How would you like to proceed?',
    note:'In order to fully explore opportunity to use TAS to accomplish the Tribe\u2019s goals, please consider taking a TAS training or contact us for a discussion on TAS.',
    a:BOUNDARY_OPTIONS()},
  q2:{tag:'Question 2 · Sources',short:'Sources',
    q:'How many air-pollution sources are within your jurisdiction?',
    a:[{label:'Many',short:'Many',to:'q2b',grants:'regulatory'},
       {label:'A few, or a local issue',short:'A few',to:'q3',grants:'targeted'},
       {label:'None or very few',short:'None/very few',to:'q3'}]},
  /* How a Tribe with many sources would implement CAA programs. The answer
     marks which of OUT.regulatory.options the full result shows as the
     reader's choice, by position — option 1 here is option 1 there. */
  q2b:{tag:'Question 2b \u00b7 Implement CAA programs',short:'Implementation',
    q:'How would you like to implement CAA programs?',
    a:[{label:'Develop your own rules/programs to submit to EPA for approval',short:'Own programs',to:'q3',
        hint:'e.g., Tribal Implementation Plan, NSR permitting, Title V permitting, stationary source standards'},
       {label:'Take delegation of federal rules/programs',short:'Delegation',to:'q3'}]},
  q3:{tag:'Question 3 · Good neighbour',short:'Good neighbour',
    q:'Do outside sources affect your air, or do you want a say in nearby permits or State Implementation Plans (SIPs)?',
    a:[{label:'Yes',short:'Yes',to:'q4',grants:'participatory'},
       {label:'No',short:'No',to:'q4'}]},
  q4:{tag:'Question 4 · Capacity',short:'Capacity',
    q:'Do you have the capacity to run an air program?',
    a:[{label:'Yes, we’re ready',short:'Ready',to:'END',
        detail:'<p>For a TAS decision, a full demonstration of capacity to run the program isn\u2019t required until you are at the program approval stage. However, if you already have the capacity to run the program, program approval and the TAS decision can be made at the same time if you would like. See the '+PEACOCK+'. If you want to discuss this in more detail, please '+CONTACT_US+'.</p>'},
       {label:'Not yet — we’d build it',short:'Building',to:'END',grants:'capacity',
        detail:'<p>In order to demonstrate that you have capacity for the eligibility determination, you do not have to have the full capacity to implement the program. For TAS, the Tribe can demonstrate how it will develop the capacity to run the program, which can include a plan for hiring and training. See the '+PEACOCK+'. If you want to discuss this in more detail, please '+CONTACT_US+'.</p>'},
       {label:'Unsure',short:'Unsure',to:'END',grants:'capacity',
        detail:'<p>If you are unsure about the status of your capacity, please review the '+PEACOCK+' or '+CONTACT_US+' or your EPA project officer.</p>'}]}
};
var OUT={
  regulatory:{name:'Regulatory TAS',title:'Be the primary implementing authority',
    body:'Develop and run the programs that permit, inspect and enforce on the sources in your jurisdiction. You choose <b>how</b>:',
    /* the question whose answer says which of these the reader chose */
    chooser:'q2b',
    options:[{h:'Develop your own rules/programs to submit to EPA for approval',
              d:'e.g., Tribal Implementation Plan, NSR permitting, Title V permitting, stationary source standards.',
              pros:['Greatest assertion of Tribal sovereignty',
                    'Provides for tailoring programs to Tribal needs',
                    'Allows the Tribe to fully implement the program, including inspection and enforcement (other than criminal enforcement for nontribal members) \u2014 '+CONTACT_US+' for further discussion',
                    'The Tribal program becomes the federally enforceable requirement for the Tribe\u2019s jurisdiction'],
              cons:['May take more resources, time and effort to develop your own program']},
             {h:'Take delegation of federal rules/programs',
              d:'Use existing federal rules (40 CFR part 71) rather than writing your own.',
              pros:['The Tribe implements the CAA programs, including developing its own permits using EPA authority',
                    'The Tribe can conduct inspections',
                    'Fewer resources needed up front for developing the rules and programs'],
              cons:['Somewhat less assertion of Tribal sovereignty',
                    'The Tribe must refer all potential violations to EPA for enforcement']}],
    sections:['§110 TIP','O₃ plans §§181–185','PM plans §§188–189','SO₂/NO₂/Pb §§191–192','CO plans §§186–187','Regional haze §169A','PSD §165','NSR §173','§167 enforcement','Title V §§501–507','§111 NSPS','§112 air toxics','§114 records','§129 solid-waste combustion','§303 emergency powers']},
  targeted:{name:'Targeted Regulatory TAS',title:'Address a specific, localized issue',
    body:'Even with only a few sources a focused program can help — for example a burning ordinance for wood smoke under a Tribal Implementation Plan.',
    sections:['§110 TIP','PM NAAQS']},
  /* Shown to readers as Administrative TAS. The key stays `participatory`:
     saved paths store it, and renaming the key would orphan every one. */
  participatory:{name:'Administrative TAS',title:'A formal “good neighbour” voice',
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
  boundary:`<p>A TAS request requires a jurisdictional showing — for a reservation, a map and legal description of the exterior boundaries; for off-reservation areas, a statement of legal counsel on the basis for jurisdiction (<code>40 CFR §49.7</code>). EPA notifies the appropriate governmental entities, including neighbouring state and local air agencies, and gives them a period to comment on the Tribe's jurisdictional assertion (<code>40 CFR §49.9</code>). EPA's approval is a final Agency action and thus subject to judicial challenge.</p><p>An adverse ruling could <b>impact the Tribe's jurisdictional boundaries, including loss of Tribal lands</b>. Please consider carefully the potential risk of asserting jurisdiction in disputed areas.</p><p>Neither comment nor a court challenge is automatic. But the showing is open to others, so the possibility belongs in the decision before you file. Which areas to request — your full jurisdictional boundaries, or undisputed areas only — is a decision for Tribal lawyers and leadership.</p>`,
  authority:`<p>TAS is a threshold status. An approval means EPA recognizes the Tribe as eligible for treatment in the same manner as a state for the Clean Air Act sections named in the request. It does not, by itself, put a program in place or give the Tribe authority to permit, inspect or enforce.</p><p>Each program must then be submitted to EPA separately and approved before the Tribe can implement or enforce it — a Tribal implementation plan under <code>§110</code>, a title V operating-permit program, delegation of the federal rules at <code>40 CFR Part 71</code>, and so on. Until that second step is complete for a given program, EPA remains the implementing authority. Plan for both stages, and for the time between them.</p>`,
  result:`<p>This result reflects only the answers selected here. It is general information to support your discussion — not legal advice, not a determination of eligibility, and not an official EPA product. Nothing has been sent to EPA.</p><p>Before anyone relies on it: confirm every section number against the current Clean Air Act and <code>40 CFR Part 49</code>, review the sections with Tribal legal counsel, and speak with your EPA Regional Office Tribal air lead.</p>`,
  print:`<p>This document was produced by the TAS Decision Tree, an unofficial planning aid. It is not an EPA product, carries no EPA endorsement or approval, and is not legal advice. It records the answers someone selected in the tool on the date it was generated, and the options those answers point to. Nothing in it has been reviewed by, filed with, or decided by EPA, and it is not an application.</p><p>If you are reading it some time later, treat it as a snapshot: the Clean Air Act, <code>40 CFR Part 49</code>, EPA guidance and the Tribe's own circumstances may all have changed. Confirm every section number against the current statute and regulation, and read it with Tribal legal counsel.</p><p>Two points are easy to lose without the rest of the tool in front of you:</p><ul><li>TAS is a threshold eligibility status. Each program must still be submitted to EPA separately and approved before the Tribe can implement or enforce it.</li><li>If the route recorded here involved a disputed or uncertain boundary: a TAS request requires a jurisdictional showing, EPA notifies the appropriate governmental entities, they may comment on the Tribe's jurisdictional boundaries, and EPA's approval is a final Agency action and thus subject to judicial challenge. An adverse ruling could impact the Tribe's jurisdictional boundaries, including loss of Tribal lands.</li></ul><p>Questions about scope or eligibility go to your EPA Regional Office Tribal air lead.</p>`,
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
