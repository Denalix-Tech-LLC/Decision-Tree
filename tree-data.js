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
/* The memo by its full title, where the eligibility box introduces it, and
   the TAS cheat sheet: EPA's fuller list of what each section means for a
   Tribe. */
var PEACOCK_FULL='<a href="https://www.epa.gov/tribal/strategy-reviewing-tribal-eligibility-applications-administer-epa-regulatory-programs" target="_blank" rel="noopener">Strategy for Reviewing Tribal Eligibility Applications to Administer EPA Regulatory Programs</a>';
var CHEAT_SHEET='<a href="https://www.epa.gov/tribal-air/clean-air-act-summary-content-applicability-tas-titles-i-iii-and-v" target="_blank" rel="noopener">Clean Air Act: Summary of Content and Applicability for TAS for Titles I, III and V</a>';

/* Said of the undisputed-only route in two places — on the option in the tree
   and in the full result — so it is written once. */
var UNDISPUTED='The Tribe may develop a TAS request for only the undisputed areas; however, the Tribe should include a statement that says something like: “The Tribe is not including [describe the disputed area] at this time but may add this area in future.” Please discuss the appropriate language with your Tribal lawyers and leadership.';

/* Said once either way of implementing is chosen: Regulatory TAS stands on
   its own, and the next question is only for a Tribe that also wants a say in
   what happens around it. The same words on both routes, because both are
   Regulatory TAS. */
var REG_ALONE='You can have Regulatory TAS by itself, or you can also apply for Administrative TAS as well if you want to have input on State/local actions that impact your area. If so, continue with the decision tree.';

/* The boundary question is asked from two answers now, and says something
   different to each: a Tribe that knows a boundary is disputed is warned about
   the risk of asserting it; a Tribe that is not sure yet is pointed at training
   first. Same question, same three ways forward, two notes. */
var BOUNDARY_OPTIONS=function(){
  return [{label:'Undisputed areas only',short:'Undisputed only',to:'q2',
           note:UNDISPUTED,detail:'<p>'+UNDISPUTED+'</p>'},
          {label:'Our full jurisdictional boundaries',short:'Full boundaries',to:'q2',
           note:'Please consider carefully moving forward with disputed jurisdiction! This could pose significant risk to the Tribe. Please contact your Tribal lawyers and Council.',
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
        hint:'e.g., Tribal Implementation Plan, NSR permitting, Title V permitting, stationary source standards',
        note:REG_ALONE},
       {label:'Take delegation of federal rules/programs',short:'Delegation',to:'q3',
        note:REG_ALONE}]},
  q3:{tag:'Question 3 · Outside sources',short:'Outside sources',
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
        detail:'<p>Please consult with your EPA Project Officer, or '+CONTACT_US+', to determine how to develop and demonstrate your capacity.</p>'}]}
};
/* The Clean Air Act sections Tribes most commonly apply for TAS under, from
   the reviewer's "TAS CAA sections" document. Each is what the section
   contains, how Tribes have applied it, and language the Tribe can lift into
   its own application ("Language for the document") — the reason it is
   applying for that section. A reader ticks the ones that fit; the printout
   and a saved document gather the ticked sections' language.

   language[].way, where present, ties a statement to one answer of the
   pathway's chooser question (OUT.regulatory.chooser, q2b) by position:
   0 develops the Tribe's own programs, 1 takes delegation. The reader's own
   route is marked, and the printout keeps only the statements that fit it. */
var ADMIN_CAA=[
  {s:'§105',h:'Section 105 – Programmatic grants for support of air pollution planning and control programs',
   contents:['This section makes grants available to air pollution control agencies to implement activities related to developing and maintaining air pollution programs.',
             'This section also describes the criteria for the grant program, including amounts, limitations, terms, conditions, maintenance of effort, reduction of payments, and opportunity for hearing.',
             'Also see 40 CFR Parts 35.570–35.578, which govern air pollution control grants to tribes (as defined in section 302(r) of the CAA) authorized under sections 105 and 301(d) of the Act.',
             'Air pollution control grants are awarded to develop and administer programs that prevent and control air pollution on the reservation or other areas within the tribe’s jurisdiction.',
             'The CFR contains definitions of expenditures and describes eligibility and financial assistance.'],
   applications:['Since the CAA Amendments of 1990, Section 105 provides grants to tribes to continue implementing programs for the control of air pollution or implementation of air quality standards, subject to certain limitations.',
                 'The CAA defines implementation as “any activity related to the planning, developing, establishing, carrying-out, improving, or maintaining of such programs.”',
                 'Tribes must have a TAS eligibility determination to receive a 95% match for a CAA 105 grant.',
                 'If the tribe does not have TAS, they are still eligible for a CAA 105 grant but must provide a 50% match for the first 2 years moving to a 40% tribal match; waivers are available for hardship.',
                 'An intertribal consortium consisting of tribes that have demonstrated eligibility is also eligible for financial assistance.'],
   language:[{t:'The Tribe is applying for TAS for section 105 to support ongoing CAA programs with the reduced grant match obligation. This does not preclude the Tribe from including 105 grants in a PPG.'}]},
  {s:'§107 / 107(d)',h:'Section 107 – Air quality control regions; 107(d) – Designation for the National Ambient Air Quality Standards',
   contents:['Each state (tribes may) is responsible for achieving and maintaining air quality standards within the state.',
             'Each state (tribes may) will submit an implementation plan that delineates how air quality standards will be achieved and maintained.',
             'States will divide up the geographic area into air quality control regions.',
             'Whenever the EPA establishes a new or revised national ambient air quality standard (NAAQS), the EPA designates areas in a state as attainment, nonattainment, or unclassifiable (not able to be classified on the basis of available information as meeting or not meeting the air quality standard).',
             'States submit recommendations to the EPA on designation and boundary for each area.',
             'Areas can be redesignated as air quality conditions change.',
             'States will submit plans to meet regional haze requirements.'],
   applications:['Although CAA section 107(d) does not explicitly reference Indian tribes or Indian country, tribes are able to participate in the designation process.',
                 'Tribes do not need TAS to participate in the designation process.',
                 'Tribes may submit designation recommendations and requests for redesignation.',
                 'Tribes may submit a plan that delineates how air quality standards will be achieved and maintained.',
                 'Tribes may divide up their geographic area into air quality regions.'],
   language:[{label:'Section 107',t:'The Tribe is applying for TAS for section 107 to determine a separate air quality control region for air quality planning purposes.'},
             {label:'Section 107(d)',t:'The Tribe is applying for TAS for section 107(d) to participate in the designation process for future National Ambient Air Quality Standards, instead of deferring to the State’s recommendations for the designation.'}]},
  {s:'§121',h:'Section 121 – Consultation',
   contents:['The state shall consult with local governments and any affected federal land managers in implementing state plans.'],
   applications:['Tribes should include state and local governments in implementation planning. TAS may encourage state consultation with tribes on SIP development.'],
   language:[{t:'The Tribe is applying for TAS for section 121 to further the opportunity to coordinate with state/local and other federal agencies on TIP/SIP development.'}]},
  {s:'§126',h:'Section 126 – Interstate pollution abatement (the good neighbor provisions)',
   contents:['(a) Written notice to all nearby states — states must provide notice to neighboring states of new major emissions sources that may negatively affect the air quality of neighboring states.',
             '(b) Petition for finding that major sources emit or would emit prohibited air pollutants — any state or political subdivision may petition EPA for a finding that a major source or group of stationary sources emits or would emit any air pollutant in violation of CAA section 110(a)(2)(D)(i).',
             '(c) Violations; allowable continued operation — major new or modified sources, notwithstanding any permit, are in violation of this section and the state implementation plan if a finding is made (see 126(b) above). Major existing sources may not operate more than three months after a finding has been made with respect to them. A source may continue operation if it complies with emissions limits and schedules provided by the EPA to meet the section 110(a)(2)(D)(i) requirements.'],
   applications:['In many cases pollution within Indian country is caused by transport from upwind state-located sources. TAS for this CAA section allows tribes to be treated as a neighboring state and to submit a petition (commonly known as a “section 126 petition”) to the EPA to review the upwind state implementation plans, as specified under section 110 of the CAA.',
                 'A section 126 petition that is submitted by a tribe and approved by the EPA may result in a federal rulemaking which places specific emission limits on the source(s) addressed in the petition.',
                 'Tribes should provide notice to the state in which they are located and any neighboring states of new major emissions sources in their jurisdiction that may negatively affect the state’s air quality.'],
   language:[{label:'Section 126(a)',t:'The Tribe is applying for TAS for section 126(a) to be able to petition EPA to require State/local air agencies to revise their SIP where sources in their jurisdiction impact the Tribe’s air quality.'},
             {label:'Section 126(b)',t:'The Tribe is applying for TAS for section 126(b) in order to be treated as a neighboring jurisdiction: to be notified by surrounding State/local air agencies, and to provide comments on State/local agency preconstruction permits and on requirements for existing sources making modifications that impact our air quality.'}]},
  {s:'§127',h:'Section 127 – Public notification',
   contents:['States shall notify the public of times when air quality standards are not met, of health hazards associated with such pollution, and enhance public awareness of measures that the public may take to improve air quality.',
             'The EPA may provide grants to assist in carrying out these requirements.'],
   applications:['Notify the public of the health hazards related to pollution when air quality standards are not met. Enhance awareness of the measures tribal members can take to improve air quality.',
                 'Tribes may apply for funding to carry out public notification regarding air quality.'],
   language:[{t:'The Tribe is applying for TAS for section 127 to support its efforts to better inform Tribal members of health hazards related to unhealthy air quality events.'}]},
  {s:'§164',h:'Section 164 – Area redesignation (Class I redesignation)',
   contents:['States may redesignate areas as Class I or II.',
             'Lands within the boundaries of Indian reservations may only be redesignated by the appropriate Indian governing body.',
             'If there are designation disagreements between states and Indian tribes, the parties may appeal to the EPA to resolve the dispute.'],
   applications:['Tribes may redesignate their lands as Class I areas.',
                 'Designation as a Class I area may provide increased protection for air quality in and around tribal lands because of the smaller increments (PSD increments) of allowable increases in pollution concentrations.',
                 'With a Class I designation, a tribe is notified when a permit application is submitted for review by the state. The permit will provide valuable information to determine any potential impacts from the permittee.',
                 'Comments from a tribe with a Class I designation may carry greater authority than comments from a tribe without a Class I designation.',
                 'Outlines rules regarding area redesignation disputes between Indian tribes and states.'],
   language:[{t:'The Tribe is applying for TAS for section 164 in order to redesignate our area as Class I and provide the highest level of air quality protection. Further, Class I designation allows for early review of permits for major modifications and new sources within a 50-mile radius of our lands. (If the Tribe wants further protection for important cultural or natural resources associated with the NAAQS pollutants, it can identify “air quality related values” here, but this is not necessary until the program implementation stage.)'}]},
  {s:'§169B',h:'Section 169B – Visibility',
   contents:['The EPA will conduct an assessment of visibility in Class I areas every five years.',
             'The EPA will establish visibility transport regions made up of states who contribute visibility pollution to Class I areas.',
             'The visibility transport commissions shall prepare reports concerning visibility challenges and remedies in their region.',
             'The Grand Canyon visibility transport commission is established.'],
   applications:['Tribes may choose to be involved in their regional visibility transport commissions (TAS not required) and develop TIPs (TAS required).'],
   language:[{t:'The Tribe is applying for TAS for section 169B to support the Tribe’s participation with State/local agencies in the development of visibility protection plans.'}]},
  {s:'§319',h:'Section 319 – Air quality monitoring',
   contents:['The EPA will establish a national air quality monitoring system for collecting air quality data throughout the United States.',
             'Defines “exceptional events” and exclusions.',
             'The air quality monitoring database is made available to the public.'],
   applications:['Tribes may establish air quality monitoring systems on their lands.',
                 'Tribes can access the monitoring data collected by the EPA.',
                 'TAS is not required.'],
   language:[]},
  {s:'§505(a)(2)',h:'Section 505(a)(2) – Treated as a neighboring jurisdiction for notification of Title V permits from surrounding state and local agencies',
   contents:[],
   applications:['Tribes have the opportunity (even without their own permitting program) to get TAS for 505(a)(2). This means that state and local permitting authorities need to treat the tribe as an affected state and follow the notice requirements in 505(a): “The permitting authority shall notify all States — (a) whose air quality may be affected and that are contiguous to the State in which the emission originates, or (b) that are within 50 miles of the source.”'],
   language:[{t:'The Tribe is applying for TAS for section 505(a)(2) to be notified by nearby State and local permitting authorities of upcoming Title V permits.'}]}
];
var REG_CAA=[
  {s:'§110',h:'Section 110 – State implementation plans for national primary and secondary ambient air quality standards; 110(o) Tribal implementation plans; 110(a)(2)(D)(i) good neighbor provisions',
   contents:['(a) Adoption of plan by state; submission to Administrator; content of plan; revision; new sources; indirect source review program; supplemental or intermittent control systems — states are required to submit plans within three years of the EPA setting or revising air quality standards. Each plan will include: enforceable emission limitations and control measures; establishment of air monitoring; a program to prevent significant deterioration of the air quality of other states; adequate state funding, personnel, and authority to carry out the plan; air quality modeling; plan revisions; and a requirement that major stationary sources pay for permits.',
             '(b) Extension of period for submission of plans — the EPA may grant an extension of 18 months for submission of a plan.',
             '(c) Preparation and publication by Administrator of proposed regulations setting forth implementation plan; transportation regulations study and report; parking surcharge; suspension authority; plan implementation — the EPA will create a federal plan for states that fail to submit an approved plan. The EPA cannot require a parking surcharge or certain bridge tolls as part of a state’s plan.',
             '(d), (e) Repealed. Pub. L. 101-549, title I, 101(d)(4), (5), Nov. 15, 1990, 104 Stat. 2409.',
             '(f) National or regional energy emergencies, determination by President — the President may suspend any part of an implementation plan to respond to national or regional energy emergencies. States may petition for this.',
             '(g) Governor’s authority to issue temporary emergency suspensions — state governors have the authority to issue temporary emergency suspensions of plans.',
             '(h) Publication of comprehensive document for each state setting forth requirements of applicable implementation plan — the EPA will publish implementation plan requirements.',
             '(i) Modification of requirements prohibited — implementation plan requirements for stationary sources may not be changed unless exceptional or emergency situations exist.',
             '(j) Technological systems of continuous emission reduction on new or modified stationary sources; compliance with performance standards — owners or operators of stationary sources must use continuous emission reduction techniques and demonstrate compliance with the Clean Air Act.',
             '(k) Environmental Protection Agency action on plan submissions — (1)–(6) cover implementation plan completeness criteria, completeness finding, finding of incompleteness, timeline for the EPA action on a plan submission, approval, disapproval, and conditional approval, plan revisions, and corrections.',
             '(l) Plan revisions — plan revisions must be adopted by the state after reasonable notice and public hearing.',
             '(m) Sanctions — the EPA may apply sanctions or prohibit construction of major stationary sources to ensure plan requirements are met.',
             '(n) Savings clauses — (1)–(3) cover existing plan provisions, attainment dates, and retention of construction moratorium which were in place prior to November 15, 1990.',
             '(o) Indian tribes — if a tribe submits an implementation plan, it shall be reviewed the same way state plans are. If a tribe’s plan is approved, the plan will apply to all areas located within the exterior boundaries of the reservation, including rights-of-way running through the reservation.',
             '(p) Reports — states must submit reports, such as relating to emission reduction, vehicle miles traveled, and congestion levels.'],
   applications:['CAA Section 110 lays out the basic requirements for tribal implementation plans (TIP).',
                 'CAA section 110(a)(2)(D) requires that state implementation plans contain provisions to “prevent significant deterioration of the air quality of other states” by complying with CAA section 126, which covers interstate transport of pollution. This is potentially important to tribes whose air quality is impacted by pollution transported from a source(s) in a neighboring state(s).'],
   language:[{t:'The Tribe is applying for TAS to develop a Tribal Implementation Plan to ensure the NAAQS are protected in our jurisdiction. Our TIP will be focused on [pollutant – ozone, particulate matter, sulfur dioxide, lead, carbon monoxide, nitrogen oxide(s); or air quality issues such as burn permitting or minor source permitting; or the TIP may be comprehensive].'}]},
  {s:'§111',h:'Section 111 – Standards of performance for new stationary sources',
   contents:['The EPA will create a list of categories of stationary sources and set standards for their performance and emissions.',
             'Each state may submit their plan for standards of emissions and enforcement for new stationary sources.',
             'Governors can ask for regulation of stationary sources that aren’t already on federal lists of regulated sources.'],
   applications:['Tribes with an EPA approved plan can take delegation to administer the program or develop tribal standards that replace federal standards.'],
   language:[{way:1,label:'Taking delegation',t:'The Tribe is applying for TAS for section 111 in order to take delegation of the New Source Performance Standards. [The Tribe may list specific standards, or take delegation of all of 111.]'},
             {way:0,label:'Developing your own requirements',t:'The Tribe is applying for TAS for section 111 in order to develop alternate, but at least equivalent, requirements to EPA’s New Source Performance Standards.'}]},
  {s:'§112',h:'Section 112 – Hazardous air pollutants',
   contents:['The EPA will regulate the emission of hazardous chemicals that represent public health risks.',
             'Each state can submit their own plan of regulation and enforcement of hazardous chemical emissions if the standards are at least as stringent as the federal standard.',
             'The EPA will monitor atmospheric depositions of major lakes and waterways.'],
   applications:['Tribes may submit plans for regulation and enforcement of hazardous chemical emissions if the standards are at least as stringent as the federal standard.',
                 'Tribes may take administrative delegation for implementing hazardous chemical regulation and enforcement plans.'],
   language:[{way:1,label:'Taking delegation',t:'The Tribe is applying for TAS for section 112 in order to take delegation of the National Emission Standards for Hazardous Air Pollutants. [The Tribe may list specific standards, or take delegation of all of 112.]'},
             {way:0,label:'Developing your own requirements',t:'The Tribe is applying for TAS for section 112 in order to develop alternate, but at least equivalent, requirements to EPA’s National Emission Standards for Hazardous Air Pollutants.'}]},
  {s:'§113',h:'Section 113 – Federal enforcement',
   contents:['The EPA may enforce state implementation plans and emissions limits through administrative orders, civil action, and in select cases, criminal penalties.'],
   applications:['Tribes can enter into memoranda of agreement with EPA regarding enforcement of TIPs and other approved tribal programs.',
                 'Tribal plans must be fully enforceable by the EPA and where appropriate by the tribe.'],
   language:[{way:0,label:'Developing your own programs, instead of taking delegation',t:'The Tribe is applying for TAS for section 113 in order to take enforcement action on our approved programs, including inspection, issuing notices of violation and enforcement actions. The Tribe understands it will need to develop a Memorandum of Understanding with EPA to conduct criminal enforcement over non-Tribal members.'}]},
  {s:'§114',h:'Section 114 – Recordkeeping, inspections, monitoring, and entry',
   contents:['The EPA may require owners/operators of emissions sources to keep records, reports, and samples of emissions and controls.',
             'The EPA may inspect emissions sites, control equipment, or records.'],
   applications:['Tribes with an EPA approved plan can take over the administration of the program, except for criminal enforcement on non-Tribal members.'],
   language:[{way:0,label:'Developing your own programs, instead of taking delegation',t:'The Tribe is applying for TAS for section 114 in order to collect the information necessary to ensure compliance with our approved programs, including accessing source records, reports, and samples of emissions and controls, as well as conducting on-site inspections. The Tribe understands that in the event of the need for a criminal notice of violation of a source owned by a non-Tribal member, the enforcement needs to be referred to EPA.'},
             {way:1,label:'Taking delegation of EPA programs',t:'The Tribe is applying for TAS for section 114 in order to collect the information necessary to ensure compliance with our approved programs, including accessing source records, reports, and samples of emissions and controls, as well as conducting on-site inspections. The Tribe understands that in the event of the need for a notice of violation, all enforcement actions need to be referred to EPA.'}]},
  {s:'§167',h:'Section 167 – Enforcement',
   contents:['The EPA and states can enforce requirements of construction or modification of major emitting facilities.'],
   applications:['Tribes with enforcement provisions in their plan can address civil enforcement requirements of major emitting facilities (TAS required).',
                 'To address criminal enforcement, tribes will need a memorandum of agreement with the EPA.'],
   language:[{way:0,label:'Developing your own programs, instead of taking delegation',t:'The Tribe is applying for TAS for section 167 to enforce requirements of construction or modification of major emitting facilities for our approved program. The Tribe understands that in the event of the need for a criminal notice of violation of a source owned by a non-Tribal member, the enforcement needs to be referred to EPA.'}]},
  {s:'§165',h:'Section 165 – Preconstruction requirements for attainment areas (Prevention of Significant Deterioration)',
   contents:['This section outlines requirements for constructing major emitting facilities (PSD, Nonattainment NSR).'],
   applications:['Tribes may take delegation or develop a TIP to implement these requirements.'],
   language:[{way:0,label:'Developing your own PSD preconstruction permitting program',t:'The Tribe is applying for TAS for section 165 to develop our own PSD permitting program. The Tribe understands that it will need to have a memorandum of understanding with EPA to conduct criminal enforcement for permit violations for sources owned by non-Tribal members.'},
             {way:1,label:'Taking delegation of EPA’s PSD preconstruction permitting program',t:'The Tribe is applying for TAS for section 165 to take delegation of EPA’s PSD permitting program. The Tribe understands that it will need to have a memorandum of understanding with EPA to conduct criminal enforcement for permit violations for sources owned by non-Tribal members.'}]},
  {s:'§169A',h:'Section 169A – Visibility protection for federal Class I areas',
   contents:['This section states the goal of protecting visibility in Class I areas.',
             'State implementation plans must address this goal.'],
   applications:['Tribes may choose to develop a TIP to address regional haze.'],
   language:[{label:'Developing a regional haze program',t:'The Tribe is applying for TAS for section 169A in order to work with the States and develop a Tribal Implementation Plan to address regional haze.'}]},
  {s:'§172',h:'Section 172 – Nonattainment plan provisions',
   contents:['Nonattainment areas have five years to become attainment. The EPA can extend that up to ten years.',
             'The EPA can provide up to two one-year extensions if the state is meeting all the requirements of its implementation plan.',
             'Nonattainment plans shall include implementation of control measures, emissions inventory, and issuing of permits.'],
   applications:['TIPs are not required, but if the tribe develops a TIP, then TAS is required.',
                 'Tribal nonattainment plans are not required to meet the same attainment dates as states.',
                 'Tribes can establish their own schedules.',
                 'The EPA will expect tribes to diligently implement their plans.'],
   language:[{label:'Developing a Tribal Implementation Plan for nonattainment',t:'The Tribe is applying for TAS for section 172 in order to develop a Tribal Implementation Plan to attain the [ozone, particulate matter, sulfur dioxide, lead, carbon monoxide or nitrogen oxides] NAAQS.'}]},
  {s:'§173',h:'Section 173 – Permit requirements (Nonattainment NSR)',
   contents:['This section lists requirements of permit programs.'],
   applications:['Tribes may take delegation of the federal implementation plan or develop TIPs to implement permit requirements.'],
   language:[{way:0,label:'Developing a nonattainment NSR plan',t:'The Tribe is applying for TAS for section 173 in order to develop a Tribal Implementation Plan for a nonattainment NSR program.'},
             {way:1,label:'Taking delegation of EPA’s nonattainment NSR plan',t:'The Tribe is applying for TAS for section 173 in order to take delegation of EPA’s nonattainment NSR program.'}]},
  {s:'§502 (Title V)',h:'Title V operating permit programs – Section 502 Permit programs',
   contents:['(a) Violations — explains the parameters of the permit program and what constitutes a violation by a source.',
             '(b) Regulations — establishes the minimum elements of a permit program, including permit applications, monitoring and reporting, program fees to be paid by the source owner or operator, program personnel, authority to administer a permit program, permit review, public comment on and availability of permit documents, and permit revisions.',
             '(c) Single permit — single permits may be issued for a facility with multiple sources.',
             '(d) Submission and approval — establishes timing for states to develop permit programs under state or local law and for the EPA Administrator to approve/disapprove the program. States may face sanctions for not submitting approvable permit programs.',
             '(e) Suspension — approved state permit programs will replace federal permit programs; however, the EPA Administrator retains the ability to enforce permits issued by a state.',
             '(f) Prohibition — establishes the requirements of a partial permit program.',
             '(g) Interim approval — interim permit program approval may be granted under certain conditions.',
             '(h) Effective date — the effective date of the permit programs is the date of approval by the EPA Administrator.',
             '(i) Administration and enforcement — if a permitting authority is not adequately administering and enforcing a program, EPA will provide notice and enforce sanctions. If a state does not correct program deficiencies, the EPA will promulgate, administer and enforce a permit program.'],
   applications:['Tribes can administer their own EPA-approved permit programs. Tribes can decide how much of the permitting program they are willing and/or able to implement. The EPA’s federal implementation plan (FIP) will administer the permit program in Indian country until tribes take on all or portions of the program.',
                 'Tribes are not subject to the same timeline as states for developing an approvable permit program. Tribes are not subject to sanctions for not developing an approvable permit program.',
                 'Tribes can also take delegation of the EPA’s federal permitting program. With delegation, the EPA remains responsible for enforcement.'],
   language:[{way:0,label:'Developing your own Part 70 operating permit program (the Section 500 subsections need not be listed)',t:'The Tribe is applying for TAS for section 500 to develop our own Title V permit program. The Tribe recognizes that it will need to have a memorandum of understanding with EPA to conduct criminal enforcement for sources owned by non-Tribal members.'},
             {way:1,label:'Taking delegation of EPA’s Part 71 operating permit program (the Section 500 subsections need not be listed)',t:'The Tribe is applying for TAS for section 500 to take delegation of EPA’s Title V permit program. The Tribe recognizes that it will need to have a memorandum of understanding with EPA to conduct enforcement for violations of the operating permits.'}]},
  {s:'§503',h:'Section 503 – Permit applications',
   contents:['(a) Applicable date — specifies the date that sources must have a permit in place.',
             '(b) Compliance plan — the source’s permit application must be submitted with a plan that specifies how the source will comply with all the requirements. The source must also certify, at least annually, that the facility is in compliance with the permit requirements and promptly report any deviations from the requirements.',
             '(c) Deadline — establishes deadlines for the permitting authority to approve/disapprove a completed permit application.',
             '(d) Timely and complete applications — if the permitting authority does not take timely final action on a permit application, the source’s failure to have a permit is not a violation.',
             '(e) Copies; availability — copies of each permit application and accompanying information must be available to the public.'],
   applications:['The tribal permitting authority should issue or deny a permit within 18 months after the receipt of a completed permit application.',
                 'The tribal permitting authority may establish a phased schedule for acting on permit applications within the first full year of their permit program.',
                 'The tribal permitting authority must make copies of the permit application and all accompanying information available to the public.'],
   language:[]},
  {s:'§504',h:'Section 504 – Permit requirements and conditions',
   contents:['(a) Conditions — establishes requirements that each permit issued include: enforceable emission limits and standards, a schedule of compliance, a requirement that the permittee submit, at least every 6 months, monitoring results, and other conditions to assure compliance.',
             '(b) Monitoring and analysis — the EPA Administrator may establish procedures for determining compliance and for the monitoring and analysis of pollutants.',
             '(c) Inspection, entry, monitoring, certification, and reporting — each permit issued must include requirements for inspection, entry, monitoring, compliance certification, and reporting to ensure compliance with the permit.',
             '(d) General permits — the permitting authority may issue a general permit covering numerous similar sources. The general permit must comply with all requirements and the source must still file an application.',
             '(e) Temporary sources — the permitting authority can issue a single permit authorizing emissions from similar operations at multiple temporary locations. The permit must include conditions that will assure compliance with all requirements at all authorized locations. The owner/operator must notify the permitting authority of each change in location. The permitting authority may require a separate permit fee for operations at each location.',
             '(f) Permit shield — deems when an issued permit is in compliance with the applicable provisions of Title V. It can protect a source from enforcement of an applicable requirement under two circumstances: 1) where that applicable requirement has been included in the permit (and is therefore enforced through the permit); or 2) where it has been determined that the requirement does not apply to the source. Under no circumstances should a permit shield be used to exempt a source from a requirement to which it is subject.'],
   applications:['The tribal permitting authority should ensure that each permit they issue includes the enforceable emission limits, schedule of compliance, monitoring results, and any other requirements of CAA 504(a) as needed.',
                 'The tribal permitting authority must ensure that each permit includes the inspection, entry, monitoring certification, and reporting requirements of CAA 504(c) as needed.',
                 'The tribal permitting authority may issue general permits that cover numerous similar sources.',
                 'The tribal permitting authority may issue a single permit authorizing emissions from similar operations at multiple temporary locations.'],
   language:[]},
  {s:'§505',h:'Section 505 – Notification to Administrator and contiguous states',
   contents:['(a) Transmission and notice — the permitting authority must submit to the EPA a copy of the permit application with the compliance plan and a copy of each proposed and final permit. The permitting authority must also notify states, whose air quality may be affected by the source and which are contiguous to the state in which the emissions originate or within 50 miles of the source, of each permit application. The permitting authority must also provide an opportunity for the affected states to submit written recommendations on the permit issuance and notification.',
             '(b) Objection by the EPA — EPA can object to any permit that is determined as not in compliance with the requirements. Also provides the parameters that allow anyone to petition EPA to object to the issuance of a permit.',
             '(c) Issuance or denial — the permitting authority must submit for the EPA review a revised permit within 90 days after the date of an objection.',
             '(d) Waiver of notification requirements — the EPA may waive the requirements of (a) and (b) of this section for any category of sources other than major sources. EPA may also establish categories of sources (except for major sources) to which the requirements of (a) and (b) of this section do not apply. In addition, the EPA may waive the state notification requirements of (a) of this section.',
             '(e) Refusal of permitting authority to terminate, modify, or revoke and reissue — the EPA will notify the permitting authority if the EPA finds cause to terminate, modify or revoke and reissue a permit. If the permitting authority fails to take action within the prescribed timeframe, the EPA may, after notice and in accordance with fair and reasonable procedures, terminate, modify, or revoke and reissue the permit.'],
   applications:['The tribal permitting authority must submit a copy of the proposed and final permit to the EPA for review. The tribal permitting authority must also notify states/tribes whose air quality may be affected by the source of each permit application and proposed permit and allow the state/tribe the opportunity to submit recommendations on the permit. If the recommendations are not accepted by the tribal permitting authority, the authority must explain why in writing.',
                 'The EPA may object to any permit that is determined as not in compliance with the requirements. Any person can petition the EPA to object to a permit — the petition must identify all the reasons for the objection.',
                 'If the EPA finds that a permit is not in compliance with the requirements, the tribal permitting authority must submit a revised permit to the EPA.',
                 'With appropriate cause, the EPA may terminate, modify, or revoke and reissue a permit. The EPA will notify the tribal permitting authority and provide the authority the opportunity to take action.',
                 'Tribes have the opportunity (even without their own permitting program) to get TAS for 505(a)(2) — see Administrative TAS.'],
   language:[]}
];
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
    caa:REG_CAA},
  targeted:{name:'Targeted Regulatory TAS',title:'Address a specific, localized issue',
    body:'Even with only a few sources a focused program can help — for example a burning ordinance for wood smoke under a Tribal Implementation Plan.',
    sections:['§110 TIP','PM NAAQS'],
    /* its "unlocks" link, and its card in the result, open Regulatory TAS's
       CAA sections: a focused program draws on the same ones */
    sectionsFrom:'regulatory'},
  /* Shown to readers as Administrative TAS. The key stays `participatory`:
     saved paths store it, and renaming the key would orphan every one. */
  participatory:{name:'Administrative TAS',title:'A formal voice in the decisions around you',
    body:'Get early review of, and standing to comment on, neighbouring states’ plans and permits — and petition EPA when outside sources affect your air.',
    caa:ADMIN_CAA},
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
    par:{t:'Administrative TAS',
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
    nodeOpen:'Open full result',
    /* a pathway's Clean Air Act sections, in its card and in the panel its
       "unlocks" link opens. caaIntro takes HTML. caaSeeAlso is the link on a
       pathway that borrows another's sections; {name} is that pathway. */
    caaLabel:'CAA sections Tribes most commonly seek',
    caaHint:'Tick the sections to include in your application. The printout and a saved document gather the language for each one you tick.',
    caaIntro:'<p>The Clean Air Act sections Tribes most commonly apply for TAS under: what each section contains, how Tribes have applied it, and language the Tribe can lift into its application. Choose as many or as few as are appropriate. For a more comprehensive list, see the TAS cheat sheet, '+CHEAT_SHEET+'.</p>',
    caaKicker:'Clean Air Act sections',
    caaContents:'Contents',
    caaApplications:'TAS applications',
    caaLanguage:'Language for your application',
    caaPick:'Include in my application',
    caaMatch:'matches your choice',
    caaNoLanguage:'No application language of its own.',
    caaSeeAlso:'See the CAA sections under {name}'
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
    reference:'Reference',
    caa:'CAA sections for your application',
    caaLead:'Draft language for the statement of the CAA sections for which the Tribe is requesting TAS eligibility. Adapt it to the Tribe before it goes into the application.'
  },
  /* the line under the canvas, and the word before a pathway on an answer.
     Plain text. */
  tree:{
    unlocks:'unlocks',
    hintStart:'Click a branch to grow the tree',
    hintGoing:'Click a branch to grow the tree · click a greyed branch to re-route',
    hintDone:`Complete — open the result, or click any greyed branch to re-route the tree.`
  },
  /* The box before Question 1, and the information box between it and the
     question. title, tag, sub and open are on the box; lead is the
     information box, plain text ("contact us" becomes a link). intro takes
     HTML and heads the panel the box opens. */
  elig:{
    tag:'Before you start',
    title:'Eligibility requirements',
    sub:'What every TAS application has to show, from EPA’s Peacock memo.',
    open:'Read the requirements',
    intro:'<p>EPA’s '+PEACOCK_FULL+', or “the Peacock memo”, has guidance on how Tribes can meet the four requirements for TAS eligibility determinations, with examples of the documentation Tribes have provided to meet them.</p><p>Each Tribe develops this part of its application on its own. The examples and guidance below are there to help the Tribe put together its TAS application.</p>',
    lead:'The following questions are designed to help you determine which sections of the CAA to consider in developing your TAS application.'
  },
  /* The eligibility requirements themselves, as the panel shows them: a
     heading and some HTML each, like the guide. */
  eligSec:[
    {h:'1) Demonstration the Tribe is federally recognized',
     html:'<p><b>Regulatory provision.</b> The Indian tribe is recognized by the Secretary of the Interior and exercises governmental authority over a reservation. 40 CFR 131.8(a)(1); see 131.3(k) and (l). An application must include a statement that the tribe is recognized by the Secretary of the Interior. 40 CFR 131.8(b)(1).</p><p><b>Examples of documentation.</b> The Secretary of the Interior publishes in the Federal Register (FR) a list of federally recognized Indian tribes (<a href="http://www.usa.gov/Government/Tribal_Sites/" target="_blank" rel="noopener">usa.gov/Government/Tribal_Sites</a>). Applicants often submit a recent copy of the FR list to establish that the tribe has federal recognition.</p>'},
    {h:'2) Demonstration the Tribe has a governing body carrying out substantial governmental duties and powers',
     html:'<p><b>Regulatory provision.</b> 40 CFR 131.8(a)(2). An application must include a descriptive statement demonstrating that the tribal government is carrying out substantial governmental duties and powers over a defined area. 40 CFR 131.8(b)(2). The statement should:</p><ul><li>Describe the form of the tribal government. 40 CFR 131.8(b)(2)(i).</li><li>Describe the types of governmental functions currently performed by the tribal government, such as, but not limited to, the exercise of police powers affecting (or relating to) the health, safety, or welfare of the affected population, taxation, and the exercise of eminent domain. 40 CFR 131.8(b)(2)(ii).</li><li>Identify the source of the tribal government’s authority to carry out the governmental functions currently being performed. 40 CFR 131.8(b)(2)(iii).</li></ul><p><b>Examples of documentation.</b> Applications discuss the organizational structure of the tribe and identify and describe the entities that exercise the executive, legislative, and judicial functions of government. Applications discuss specific regulatory, legislative, executive and judicial activities the tribe undertakes, including actions to exercise its police power to protect the environment, e.g. establishing regulatory programs or carrying out permitting and enforcement activities. Applications identify sources of the tribal government’s authority, which may include oral or written tradition, an oral or written tribal constitution, tribal ordinances, codes, by-laws, charters, and resolutions, relevant provisions of federal treaties, executive orders or statutes, etc.</p>'},
    {h:'3) Demonstration of Tribal jurisdiction',
     html:'<p><b>Regulatory provision.</b> The functions to be exercised by the Indian tribe pertain to the management and protection of air resources within the exterior boundaries of the reservation or other areas within the tribe’s jurisdiction. 40 CFR 49.6(c). A tribe’s application should include a descriptive statement of the Indian tribe’s authority to regulate air quality. 40 CFR 49.7(a)(3). For applications covering areas within the exterior boundaries of the applicant’s reservation, the statement must identify with clarity and precision the exterior boundaries of the reservation including, for example, a map and legal description of the area. 40 CFR 49.7(a)(3).</p><p>For tribal applications covering areas outside the boundaries of the reservation, the statement should include:</p><ul><li>A map or legal description of the area over which the application asserts authority. 40 CFR 49.7(a)(3)(i).</li><li>A statement by the applicant’s legal counsel (or equivalent official) that describes the basis for the tribe’s assertion of authority (including the nature or subject matter of the asserted regulatory authority), which may include a copy of documents such as tribal constitutions, by-laws, charters, executive orders, codes, ordinances, and/or resolutions that support the tribe’s assertion of authority. 40 CFR 49.7(a)(3)(ii).</li></ul><p><b>Examples of documentation.</b> EPA interprets CAA § 301(d) as a Congressional delegation of authority to eligible federally recognized tribes for all air resources within a reservation. Thus, a tribe’s application must establish the reservation’s location and boundaries. Applications include maps showing the area and air resources over which the tribe asserts authority.</p><ul><li>A map may be based on an official survey by the U.S. Department of the Interior or an official map of the reservation prepared by the Bureau of Indian Affairs.</li><li>A written legal description discusses with some specificity the locations of the boundaries of the reservation areas over which the tribe asserts authority.</li><li>Legal counsel statements identify and discuss the legal basis for the tribe’s assertions of authority over areas covered by the application, with special attention to showing the tribe has jurisdiction over nonmember activities, if applicable.</li></ul>'},
    {h:'4) Demonstration the Tribe is reasonably expected to be capable of effectively administering the Clean Air Act program',
     html:'<p><b>Regulatory provision.</b> The tribe is reasonably expected to be capable of effectively administering the Clean Air Act program for which the tribe is seeking approval. 40 CFR 49.6(d). The application should include a narrative statement describing the capability of the applicant to administer effectively the Clean Air Act program for which the tribe is seeking approval. The narrative statement must demonstrate the applicant’s capability consistent with the applicable provisions of the Clean Air Act and implementing regulations. 40 CFR 49.7(a)(4). And, if requested by the Regional Administrator, the statement may include:</p><ul><li>A description of the Indian tribe’s previous management experience, which may include the administration of programs and services authorized by the Indian Self-Determination and Education Assistance Act (25 U.S.C. 450, et seq.), the Indian Mineral Development Act (25 U.S.C. 2101, et seq.), or the Indian Sanitation Facility Construction Activity Act (42 U.S.C. 2004a). 40 CFR 49.7(a)(4)(i).</li><li>A list of existing environmental or public health programs administered by the tribal governing body and a copy of related tribal laws, policies, and regulations. 40 CFR 49.7(a)(4)(ii).</li><li>A description of the entity (or entities) that exercise the executive, legislative, and judicial functions of the tribal government. 40 CFR 49.7(a)(4)(iii).</li><li>A description of the existing, or proposed, agency of the Indian tribe that will assume primary responsibility for administering a Clean Air Act program (including a description of the relationship between the existing or proposed agency and its regulated entities). 40 CFR 49.7(a)(4)(iv).</li></ul><p><b>Examples of documentation.</b> In addition to experience with the federal programs listed in the regulation, tribal applications may also discuss the tribe’s previous management experience with its own tribal programs. This discussion need not address environmental program management experience, which is included in the next heading. Applications describe a tribal air, water, or waste management program, or any other environmental or public health programs administered by the tribe, as well as tribal experience with resource management. Relevant documents include copies or summaries of tribal laws and regulations governing the described program(s). A tribe is not required to have experience in administering environmental programs, but a tribe with such experience may wish to provide such information. Applications describe the tribal governmental system. This information may overlap with or duplicate information about the tribal governmental structure and functions discussed under 40 CFR 49.7(a)(2) above, and a tribe may refer to, rather than repeat, that information. Applications describe the tribe’s environmental management program.</p>'},
    {h:'5) A statement of the sections of the CAA for which the Tribe is requesting TAS eligibility',
     html:'<p>The decision tree helps you choose them. Each pathway in the full result, and every “unlocks” link in the tree, opens the Clean Air Act sections Tribes most commonly apply for under it, with language you can lift into this statement. Tick the sections that fit your Tribe, as many or as few as are appropriate: the printout and a saved document gather the language for each section you tick.</p><p>For a more comprehensive list, see the TAS cheat sheet, '+CHEAT_SHEET+'.</p>'}
  ],
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
    eligLabel:'Open the eligibility requirements',
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
