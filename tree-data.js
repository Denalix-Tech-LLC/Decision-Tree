/* ===========================================================================
   TAS DECISION TREE — CONTENT
   The single source of truth for what the tree asks and what it recommends,
   and for every other word a reader meets on the tree: the guide, the
   walkthrough, the button labels, the result's headings. Loaded by all three
   pages — the tree (index.html), the editor (admin.html) and /work, which
   only reads THEME from it.

   Precedence, lowest to highest:
     1. this file                            (what the repo ships)
     2. /api/tree                            (what the editor published)
     3. a draft saved from /admin            (localStorage, this browser only)
     4. a saved tree or a saved path's snapshot, opened deliberately

   Anything later on that list that is missing a newer key — an old draft
   with no THEME, a saved path from before COPY existed — falls back to this
   file for that key, so adding a line here never blanks a page.

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
   NOTE: GUIDE and COPY below quote the pathway names and the result panel’s
   running order. Rename a pathway in OUT and they go out of date with it —
   the editor cannot warn about that. */
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
   into it as a prefill. Another https scheduling link is offered as a plain
   new-tab link, with nothing the reader typed attached; anything that is not
   an https address is ignored (see calLink() in index.html). */
var CONTACT={name:'',role:'',email:'',phone:'',calendly:''};

/* The guide: the full manual behind the walkthrough's "Full guide" button.
   It describes the tool as built — change the tool and this changes with it.
   Its fourth and fifth sections name the pathways, so a rename under
   Pathways needs making here too; the editor's checks at /admin flag a
   pathway name the guide still uses after a rename. */
var GUIDE=[
  {h:'What this tool is for',
   html:`<p>This tool helps you think through whether your Tribe should seek <b>treatment in the same manner as a state</b> (TAS, commonly "treated as a state") under the Tribal Authority Rule, <code>40 CFR Part 49</code>, EPA's rule implementing Clean Air Act <code>§301(d)</code> — and if so, for which Clean Air Act sections.</p><p>You answer four main questions, with a follow-up after some answers: whether any jurisdictional boundaries are disputed and how you would proceed; how many emission sources are in your jurisdiction and, if there are many, how you would implement Clean Air Act programs; whether outside sources affect your air; and whether you have the capacity to run a program. The tree grows as you answer and shows the routes that follow.</p><p>The decision itself belongs to Tribal leadership, Council and Tribal legal counsel. The limits of this tool are set out in the notice on this page and in the bar above the tree.</p>`},
  {h:'Moving around the canvas',
   html:`<p>Drag anywhere on the background to move the canvas. A scroll wheel or a two-finger trackpad swipe moves it too — scrolling pans rather than zooms, so the tree does not change size by accident. Hold <code>shift</code> while scrolling to move sideways.</p><p>To zoom, hold <code>ctrl</code> (or <code>cmd</code> on a Mac) while scrolling, pinch on a touchscreen, or use <b>+</b> and <b>−</b> at the bottom left. <b>Fit</b> frames the whole tree at once.</p><p>Panning is held so that part of the tree always stays on screen.</p>`},
  {h:'Answering, and changing your mind',
   html:`<p>One question is active at a time, with its answers fanned beneath it. Click an answer and the tree grows: the line to the next question draws itself, the question fades in, then its options arrive one at a time. You can also press the number of an option on the active question, or move between cards with <code>Tab</code> and choose with <code>Enter</code>.</p><p>Answers you did not take stay on the canvas, greyed and pushed slightly out of focus, so the whole decision stays visible. <b>Click a greyed answer and the tree re-routes down that branch instead</b> — useful for showing Council what the other choice would have led to.</p><p>Every question you have already answered carries a small <b>x</b>. Clicking it cuts the tree back to that question and reopens it with all its options live; everything that grew below it comes away, because it no longer follows from your answers.</p><p><b>Start over</b> in the top bar withdraws the tree, deepest limb first, and returns you to question one. Each choice plays a short tone; the <b>Sound</b> button turns that off.</p>`},
  {h:'What the pathways mean',
   html:`<p>Some answers unlock a <b>pathway</b> — a route worth considering, with the Clean Air Act sections that go with it. There are four:</p><ul><li><b>Regulatory TAS</b> — the route to running your own permitting, inspection and enforcement program for sources in your jurisdiction, once EPA approves the program itself.</li><li><b>Targeted Regulatory TAS</b> — the same route for a narrower program aimed at one local problem, such as smoke from open burning.</li><li><b>Administrative TAS</b> — a formal role as a neighbouring government: notice of and comment on nearby plans and permits, and a route to ask EPA to act on sources outside your jurisdiction.</li><li><b>Capacity building</b> — ways to move toward TAS while you build staff and expertise, rather than waiting until they are in place.</li></ul><p>Pathways accumulate and are not exclusive. Many sources <i>and</i> a wish for a say in nearby permits finishes with both Regulatory and Administrative. A pathway stays unlocked unless you change the answer that unlocked it.</p><p>A pathway is a direction to consider, not a finding of eligibility. EPA decides eligibility against the four criteria at <code>40 CFR §49.6</code>, which the result panel lists. Part 49 also does not open every Clean Air Act provision to Tribes — <code>§49.4</code> lists the provisions for which Tribes are not treated as states, including implementation-plan submittal deadlines and the sanctions tied to them.</p>`},
  {h:'What you get at the end',
   html:`<p>When you reach an ending, a warm light rises over the scene and a <b>Result</b> button appears in the top bar. The panel slides over the canvas; the tree stays as you left it behind it. Close it with <b>Back to the tree</b> or <code>escape</code>.</p><p>The panel holds:</p><ul><li>a headline naming the pathway, or combination, your answers point to, and a sentence on why;</li><li>the Clean Air Act sections to consider seeking, and the pathways unlocked;</li><li>a <b>boundary-risk note</b>, when a boundary answer came up — read it in full there;</li><li>one card per unlocked pathway, with the sections to seek under it — for Regulatory TAS, the pros and cons of writing your own programs against taking delegation of the federal ones;</li><li>what your capacity answer means for a TAS request, with a link to EPA's Peacock memo;</li><li>the options that need no TAS at all — inherent Tribal authority, <code>§103</code> grants, monitoring, education, indoor-air and radon work;</li><li>the four eligibility criteria at <code>40 CFR §49.6</code>, and what a request must contain under <code>§49.7</code>;</li><li>next steps, and links to EPA's pages on the Tribal Authority Rule.</li></ul><p>One point to carry into any discussion: TAS eligibility is a threshold status. Each program must then be submitted to EPA separately and approved before the Tribe can implement or enforce it.</p>`},
  {h:'The printed document',
   html:`<p><b>Print</b> at the top of the result panel prints the result or saves it as a PDF, depending on what you choose in your browser's print dialog.</p><p>It opens with a drawing of the route you took — each question, the answer chosen, the pathway it unlocked, and the result — then the written sections: the recommended pathways with their sections, the non-TAS options, the eligibility criteria, next steps, references, and the standing notice. Someone who was not at the screen can read it and see both what the tool pointed to and how you got there.</p><p><b>Confirm every section number against the current Clean Air Act and 40 CFR Part 49 before anyone relies on it.</b> Sections are amended and renumbered, and this is not an official EPA product.</p>`},
  {h:'Changing the content',
   html:`<p>Everything a reader sees here can be changed in the editor at <code>/admin</code>: the questions and answers, the pathways, the result and its headlines, this guide, the walkthrough, the Contact panel, the disclaimers, the wording on every button, and the photograph behind the tree. Edits save to that browser as you type, so the tree on that machine shows them straight away — and only there.</p><p><b>Publish</b> in the editor puts the change in front of every reader. <b>Export</b> downloads a <code>tree-data.js</code> file, for replacing the one the site ships.</p>`},
  {h:'Keeping your work, and using this as a guest',
   html:`<p>You can use every part of this tool without an account. Answer the questions, re-route the tree, open the result, print it. Nothing is sent anywhere and nothing is required of you.</p><p>What a guest cannot do is <b>keep</b> any of it. Close the tab and the path is gone; the editor's working copy lives in this browser on this machine, and clearing the browser clears it. <b>Print</b> is how a guest keeps a result — the print-out is written to stand on its own.</p><p>Signing in takes one of two forms — <b>Continue with Google</b>, or an email address and a password you choose. Either way it adds three things and changes nothing else:</p><ul><li><b>Save</b> in the top bar keeps the path you are on — every answer, and the tree as it stood when you answered it. Open it again later and the tree grows back to exactly where you left off, whatever has been edited since.</li><li><b>Save as document</b>, in the result, turns the result into a document you can edit word by word, print, and open again months later.</li><li>At <code>/admin</code>, <b>My trees</b> keeps your version of the questions and recommendations somewhere other than one browser.</li></ul><p>All of it sits under <b>My work</b>, reached from the account button in the top bar. Deleting something there moves it to a deleted list rather than destroying it, and you can restore it or delete it for good.</p><p>An account here is a place to keep work, nothing more. It is not a submission to EPA, it is not visible to anyone else, and no one is notified when you save. Signing in with Google tells this tool your name, your email address and nothing else, and gives it no ability to do anything in your Google account. If the deployment you are using has no storage behind it, or has not been set up for Google, the sign-in panel says so and offers what it does have.</p>`},
  {h:'Working on the document afterwards',
   html:`<p>The result panel prints, but it does not let you change a word. <b>Save as document</b> does: it takes the print-out exactly as it stands — the drawing of the route, the answers, the pathways and their sections, the criteria, the next steps, the references and the standing notice — and keeps it on your account as something you can rewrite. On <b>My work</b> you can also turn any saved path into a document later, with <b>Make a document</b>.</p><p>Open it at <b>My work → Documents</b>. The title at the top is a plain field; the body below it is the document itself, edited in place. The toolbar holds what a briefing needs and nothing else: <b>B</b>, <b>I</b> and <b>U</b>; <b>Heading</b>, <b>Sub</b> and <b>Text</b> for the three levels; bulleted and numbered lists; <b>Quote</b> for something set apart; <b>Clear</b> to strip formatting off a selection that came in wearing someone else's; <b>Rule</b> for a horizontal line; and undo and redo.</p><p>Text pasted from elsewhere arrives as plain text on purpose. A block of another page's HTML is the quickest way to make a document that will not print properly.</p><p>It <b>saves itself</b> about a second after you stop typing. The line beside <b>All documents</b> says <i>Saving…</i>, then <i>Saved</i>, and says so plainly if a save failed — if it ever does, the words are still on your screen, so do not close the tab. <b>Save</b> forces it immediately, and so does <code>ctrl</code>+<code>s</code>.</p><p><b>Print / Save PDF</b> prints what you have made of it, not what the tree produced — the editing tools and the page around them are not printed. <b>Duplicate</b> before a substantial rewrite gives you the earlier version to go back to; there is no version history beyond the copies you make. <b>Delete</b> moves a document to the deleted list, where <b>Restore</b> brings it back.</p><p>Two things a document does <i>not</i> do. Editing it never changes the tree, and never changes the saved path it came from — so the record of what was actually answered survives whatever you write on top of it. And a document is a snapshot: it does not update if you later change an answer or edit the content at <code>/admin</code>. To reflect a changed decision, make a new document and keep or delete the old one deliberately.</p><p>As a guest none of this is available, because nothing can be kept. <b>Print</b> in the result is the way to take a copy away with you.</p>`},
  {h:'Getting help',
   html:`<p><b>Contact</b> in the top bar reaches whoever maintains this tool — use it for a citation that looks wrong, a question that reads badly, or behaviour you did not expect.</p><p>For the decision itself, work with Tribal legal counsel and then your EPA Regional Office Tribal air lead, who can confirm scope and what a request needs. <b>Guide</b> in the top bar brings back the walkthrough, and <b>Full guide</b> on any of its screens opens this page again.</p>`}
];

/* Every other piece of wording a reader meets, grouped by where they meet it.
   Edit at /admin → Wording. A key left out of an older draft or saved tree
   falls back to what is here, so adding a line never blanks a page. */
var COPY={
  /* The name of the tool, as the top bar and the browser tab show it.
     kicker is the small capitals line above the title; pageTitle is what the
     tab and a bookmark say. Plain text, all three. */
  brand:{
    kicker:'Clean Air Act · Treated as a State',
    title:'TAS Decision Tree',
    pageTitle:'TAS Decision Tree'
  },
  /* The result's headline and the sentence under it, chosen by which
     pathways the answers unlocked. They name pathways, so a pathway renamed
     under Pathways needs renaming here too. Plain text. */
  verdicts:{
    /* The reader chose not to pursue TAS now */
    nontas:{t:'A non-TAS pathway fits best right now',
      s:`You can protect your air and build capacity without TAS, and revisit once the boundary question is resolved.`},
    /* Regulatory and Administrative both unlocked */
    regPar:{t:'Regulatory + Administrative TAS',
      s:`You have sources to manage and reasons to influence what happens next door — seek both roles. They are not mutually exclusive.`},
    /* Targeted and Administrative both unlocked */
    tgtPar:{t:'Targeted + Administrative TAS',
      s:`A focused program at home, plus a formal voice in the decisions made around you.`},
    /* Regulatory unlocked */
    reg:{t:'Regulatory TAS',
      s:`Become the primary implementing authority for the air-pollution sources in your jurisdiction.`},
    /* Targeted unlocked */
    tgt:{t:'Targeted Regulatory TAS',
      s:'A focused program can address your specific local air-quality issue.'},
    /* Only Administrative unlocked */
    par:{t:'Administrative (good-neighbour) TAS',
      s:`Get a formal, early voice in the state and local decisions that affect your air quality.`},
    /* No pathway unlocked */
    none:{t:'TAS may offer limited near-term benefit',
      s:`With few sources and no outside concern, non-TAS programs may serve you now — but the option stays open as things change.`},
    /* A printout or document made before the path reaches an ending */
    progress:{t:'TAS decision — in progress',
      s:'This path is not yet complete.'}
  },
  /* labels and fixed paragraphs in the result panel. noneBody, sectionsNote
     and criteriaLead take HTML; the rest are plain text. nodeTag and
     nodeOpen are the card at the end of the tree, and nodeTag also heads the
     last box of the drawing on the print-out. */
  result:{
    statSections:'CAA sections',
    statSectionsSome:'to consider seeking',
    statSectionsNone:'none required for this route',
    statPathways:'Pathways',
    statPathOne:'recommended route',
    statPathMany:'complementary routes',
    statPathNone:'non-TAS route',
    boundaryRk:'Keep in view',
    boundaryH:'Your boundary showing is open to others',
    pathwaysTitle:'Recommended pathway',
    pathwaysTitleMany:'Recommended pathways',
    sectionsLabel:'Sections you may seek:',
    yourChoice:'Your choice',
    pros:'Pros',
    cons:'Cons',
    yourAnswer:'your answer',
    noneRk:'Worth knowing',
    noneH:'You have strong options without TAS today',
    noneBody:`With little source activity and no outside concern right now, the non-TAS pathways below may meet your needs. TAS remains available whenever sources appear or priorities shift.`,
    sectionsNote:`Section numbers point you to the right part of the law — they are not authority to quote. See the note at the foot of this panel.`,
    nontasRk:'No TAS required',
    nontasH:'Also available — with or without TAS',
    nontasHDeclined:'Your non-TAS pathway',
    authorityTitle:'Eligibility is not authority',
    authorityRk:'Two stages',
    criteriaTitle:'Before you file — the four eligibility criteria',
    criteriaLead:`To be approved, your Tribe must be able to demonstrate all four (40 CFR §§ 49.6 / 49.7):`,
    nextTitle:'Next steps',
    referenceRk:'Reference',
    nodeTag:'Result',
    nodeOpen:'Open full result'
  },
  /* headings in the printout, plain text; {date} is replaced with the day it
     is printed */
  print:{
    stamp:'Generated {date} by the TAS Decision Tree',
    route:'The route taken',
    answers:'Answers chosen',
    pathways:'Recommended pathways',
    yourChoice:'(your choice)',
    about:'About your answers',
    boundaryPrefix:'Boundary risk',
    nontas:'Non-TAS options',
    criteria:'The four eligibility criteria (40 CFR §§ 49.6 / 49.7)',
    next:'Next steps',
    reference:'Reference'
  },
  /* the line under the canvas, and the word before a pathway on an answer.
     Plain text. */
  tree:{
    unlocks:'unlocks',
    hintStart:'Click a branch to grow the tree',
    hintGoing:'Click a branch to grow the tree · click a greyed branch to re-route',
    hintDone:`Complete — open the result, or click any greyed branch to re-route the tree.`
  },
  /* the Contact panel, and the email it drafts. lead, leadNoCal, calNote,
     calLinkNote, noCal, whoTodo, counsel and privacy take HTML; the rest are plain text,
     and the three mail lines go into an email, where tags would show. cue is
     the callout that points at Contact while a risky question is open. */
  contact:{
    lead:'<p>Book a time, or just ask — whichever suits the question.</p>',
    leadNoCal:`<p>Ask whatever you need to. Whoever maintains this tool answers it.</p>`,
    cue:'Worth a word with counsel',
    askH:'Ask a question',
    askLabel:'What would you like to know?',
    askPlaceholder:'For example: what would a jurisdictional showing have to cover for us?',
    calH:'Book a time',
    calNote:`Calendly shows real availability, and carries across anything you have typed above. It is a service outside the Tribe.`,
    calLinkNote:`This scheduling page is on a service outside the Tribe. It opens in a new tab, and nothing you have typed above is sent to it.`,
    noCal:`There is no scheduling link on this deployment, so the question above is the way through. To offer a calendar here, paste a Calendly event link into <b>Content → Contact</b> at <code>/admin</code>.`,
    whoH:'Who this reaches',
    whoTodo:`All of these are placeholders. The Tribe deploying this tool fills them in before it is shared.`,
    counsel:`<p><b>Tribal legal counsel and Tribal leadership come before EPA.</b> A TAS request needs a jurisdictional showing, and EPA provides that showing to neighbouring state and local air agencies — so counsel should read what the Tribe is about to assert before anyone outside the Tribe does.</p>`,
    privacy:`<p>Nothing on this page is sent anywhere on its own. The question opens in your own email program, so you can read and change every word before it goes; booking a time goes to Calendly, which is a service outside the Tribe.</p>`,
    mailSubject:'TAS decision tool — a question',
    mailIntro:'Where this comes from — my answers in the tool:',
    mailSign:'Sent from the TAS Decision Tree.'
  },
  /* the five-screen walkthrough; its drawings stay in index.html */
  walk:[
    {h:'A tool for one decision',
     html:`<p>This helps a Tribe think through whether to seek <b>treatment in the same manner as a state</b> under the Tribal Authority Rule — and if so, for which Clean Air Act sections.</p><p>It asks four main questions, with a follow-up after some answers. Each opens beneath the last, and the answers you give draw a route through them.</p><div class="wnote"><b>Read this first.</b> This is not an official EPA product and it is not legal advice. It determines nothing and sends nothing to EPA. What you get at the end is a written summary of the route you chose — something to open a conversation with Tribal legal counsel, leadership and Council.</div>`},
    {h:'Answer, and the tree grows',
     html:`<p>Click an answer. The line to the next question draws itself, the question fades in, and its own answers arrive under it one at a time.</p><p>You can also press the <b>number</b> of an answer, or move between cards with <code>tab</code> and choose with <code>enter</code>.</p><p>Drag the background to move the canvas. Scrolling pans rather than zooms, so the tree never changes size by accident — hold <code>ctrl</code> and scroll to zoom, and <b>Fit</b> at the bottom left frames the whole thing.</p>`},
    {h:'Nothing you do is stuck',
     html:`<p>The answers you did not take stay on the canvas, greyed. <b>Click a greyed answer</b> and the tree re-routes down that branch instead — which is how you show Council what the other choice would have led to.</p><p>Every answered question carries a small <b>&#10005;</b>. Click it and the tree withdraws back to that question and reopens it, because everything below it no longer follows from your answers.</p><p><b>Start over</b> in the top bar takes the whole tree back to question one.</p>`},
    {h:'Pathways, and what you get',
     html:`<p>Some answers unlock a <b>pathway</b> — a route worth considering, with the Clean Air Act sections that go with it. They accumulate: many sources <i>and</i> a wish for a say in nearby permits finishes with two.</p><p>At the end, <b>Result</b> opens a panel holding the pathways, the sections to consider seeking, the four eligibility criteria, next steps, and the notes that belong with them. <b>Print</b> turns it into a document written to stand on its own months later, in front of someone who was not at the screen.</p><p>A pathway is a direction to consider, not a finding of eligibility — EPA decides that.</p>`},
    {h:'Keeping what you do here',
     html:`<p>You can use every part of this as a <b>guest</b>: answer the questions, re-route, open the result, print it. Nothing is asked of you and nothing is sent anywhere.</p><p>What a guest cannot do is <b>keep</b> it. Close the tab and the path is gone — so <b>Print</b> is how you take a copy away with you.</p><p>Signing in adds somewhere to put it: the path you answered, and the result as a document you can edit and come back to next month. The account button in the top bar is there whenever you want it, and never before.</p><p style="color:var(--muted);font-size:13.5px"><b>Full guide</b>, at the top of this box, goes into all of it properly — moving around the canvas, what each pathway means, editing a saved document, and who to ask. <b>Guide</b> in the top bar brings these five screens back at any point.</p>`}
  ],
  /* The page's own furniture: button labels, the tooltips and screen-reader
     labels that go with them, and the chrome around the walkthrough, the
     guide, the Contact panel and the result. Plain text, every one, except
     guideFoot, which takes HTML. A word in {braces} is filled in by the page
     — {tag} and {question} with the question's label and wording, {result}
     with the result's headline, {n} and {total} with the walkthrough's step
     and its length — so keep the braces when rewording. A tooltip is the
     line that appears on hover; a label is what a screen reader says. The
     sign-in dialogs and the notes that pop up after saving belong to the
     account system and are not here. */
  ui:{
    /* the top bar */
    guide:'Guide',
    guideTip:'How to use this tool — the five-screen introduction',
    contact:'Contact',
    contactTip:'Talk to a person',
    contactTipRisky:'This question is worth a conversation — talk to a person',
    result:'Result',
    save:'Save',
    saveTip:'Keep this path on your account and come back to it later',
    update:'Update',
    updateTip:'Save this path again — it has changed since you last saved it',
    soundOn:'Sound',
    soundOff:'Muted',
    soundOnTip:'Sound on — click to mute',
    soundOffTip:'Sound off — click to unmute',
    startOver:'Start over',
    noticeLabel:'Note',
    /* on the canvas */
    zoomIn:'Zoom in',
    zoomOut:'Zoom out',
    zoomFit:'Fit tree to screen',
    answerAgain:'answer again',
    switchBranch:'switch',
    dismissNote:'Dismiss this note',
    rewindTip:'Cut the tree back to this question and answer it again',
    rewindLabel:'Cut the tree back to {tag} and answer it again',
    reopenLabel:'Go back to {tag} — {question}. Retracts the tree so you can answer it again.',
    optionChosen:'your current choice',
    optionSwitch:'switch the tree to this branch',
    resultLabel:'Your result: {result}. Open the full result.',
    /* the walkthrough */
    walkStep:'Step {n} of {total}',
    walkFullGuide:'Full guide',
    walkFullGuideTip:'Everything here, in full, plus the parts a walkthrough leaves out',
    walkSkip:'Skip',
    walkBack:'Back',
    walkNext:'Next',
    walkBegin:'Begin the tree',
    /* the guide */
    guideKicker:'Before you start',
    guideHeading:'How to use this tool',
    guideNot:'What this tool is not',
    guideStart:'Start the tree',
    guideWalk:'Walkthrough',
    guideWalkTip:'The five-screen introduction, again',
    guideFoot:'The <b>Guide</b> button in the top bar brings back the walkthrough, and <b>Full guide</b> on any of its screens opens this again.',
    closeGuide:'Close the guide',
    /* said on more than one surface */
    close:'Close',
    backToTree:'Back to the tree',
    /* the Contact panel */
    contactKicker:'Contact',
    contactHeading:'Talk to a person',
    askName:'Your name',
    askEmail:'Your email, so they can reply',
    askPath:'Include my answers from the tree',
    askPathNote:'The questions, what you chose, the pathways unlocked and the result.',
    calNewTab:'New tab',
    calLinkOpen:'Open the scheduling page',
    calFrameTitle:'Book a time — Calendly',
    whoName:'Name',
    whoRole:'Role',
    whoEmail:'Email',
    whoPhone:'Phone',
    send:'Send question',
    sendTip:'Opens this in your own email program',
    sendNoEmailTip:'No email address is set up yet — copy the text instead',
    writeFirstTip:'Write your question first',
    copy:'Copy',
    copyTip:'Copy it to paste wherever you like',
    copied:'Copied',
    copyFailed:'Could not copy',
    footReady:'Nothing is sent until you press send in your own email program.',
    footEmpty:'Write a question, or book a time.',
    /* in the email text, when the reader left a field empty */
    mailTo:'To',
    mailSubjectLabel:'Subject',
    mailNoName:'[your name]',
    mailNoEmail:'[email address]',
    /* the result panel */
    sheetLabel:'Your tailored result',
    sheetKicker:'Your pathway',
    print:'Print',
    printTip:'Print this result, or save it as a PDF',
    printPdf:'Print / Save PDF',
    saveDoc:'Save as document',
    saveDocTip:'Keep this result as a document you can edit, print and come back to'
  }
};

/* The photograph behind the tree, on all three pages.

   photo is exactly one of three things, and anything else is treated as
   'land.jpg':
     'land.jpg'                the photograph shipped beside the pages
     ''                        no photograph — the plain page colour shows
     '/api/media/<sha256>'     one uploaded at /admin, served by this site
   That short list is a security boundary rather than tidiness. The value
   ends up inside a CSS url(), so free text there could break out of it; and
   this tool promises a reader it makes no request to anywhere else, which a
   link to another site's image would quietly break. look.js enforces the
   list in the browser and the server enforces it on publish.

   position is where the picture is anchored vertically, in percent: 0 keeps
   its top edge, 100 its bottom. opacityLight and opacityDark are how
   strongly it shows through, 0 to 1, in each theme; null means the value in
   theme.css (.66 light, .3 dark).

   Choosing the photograph is a decision for the Tribe deploying this, not a
   default to be shipped. A photograph of one nation's country used as
   decoration on a tool other nations open makes a claim about whose land it
   is. Use one the Tribe owns or has cleared, and check the rights — an
   uploaded image is served publicly alongside the page. */
var THEME={photo:'land.jpg',position:56,opacityLight:null,opacityDark:null};

  var DATA={NODES:NODES,OUT:OUT,NONTAS:NONTAS,CRITERIA:CRITERIA,NEXT:NEXT,LINKS:LINKS,
            DISC:DISC,CONTACT:CONTACT,GUIDE:GUIDE,COPY:COPY,THEME:THEME};
  if(typeof window!=='undefined') window.TAS_TREE=DATA;
  if(typeof module!=='undefined'&&module.exports) module.exports=DATA;
})();
