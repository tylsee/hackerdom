import type { Category, DocumentData, WizardData } from './types';
export const categories = {
  education: {
    name: 'Education',
    subtitle: 'From discovery to understanding.',
    description: 'Turn practical work into clear reports, tutorials and assignments.',
    types: ['Lab report', 'Tutorial', 'Assignment'],
    template: 'Academic report',
    tone: 'Academic, precise, evidence-led',
    sections: [
      'Objective',
      'Materials & setup',
      'Procedure',
      'Results & discussion',
      'Conclusion',
      'References',
    ],
    chips: ['Results table', 'Error discussion', 'Hypothesis', 'List of figures', 'References'],
    conventions: [
      'Numbered figures & captions',
      'In-text figure references',
      'Academic section structure',
    ],
  },
  work: {
    name: 'Work',
    subtitle: 'Knowledge that keeps teams moving.',
    description: 'Make your expertise repeatable with guides your team can trust.',
    types: ['SOP', 'Training manual', 'Process guide'],
    template: 'Standard operating procedure',
    tone: 'Direct, structured, safety-first',
    sections: [
      'Purpose & scope',
      'Safety & equipment',
      'Procedure',
      'Verification checkpoints',
      'Revision history',
    ],
    chips: ['PPE', 'Checkpoint', 'Revision history', 'Escalation contact', 'Machine ID'],
    conventions: [
      'Numbered steps & checkpoints',
      'Safety and caution callouts',
      'Version & ownership block',
    ],
  },
  personal: {
    name: 'Personal',
    subtitle: 'The things you know, shared beautifully.',
    description: 'Give your recipes, everyday routines and how-to guides a home.',
    types: ['Recipe', 'How-to guide', 'Care guide'],
    template: 'Everyday guide',
    tone: 'Warm, simple, easy to follow',
    sections: [
      'Overview',
      'Ingredients & materials',
      'Method',
      'Tips & substitutions',
      'Storage & care',
    ],
    chips: ['Quantities', 'Prep & cook time', 'Serving size', 'Substitutions', 'Storage tips'],
    conventions: [
      'Materials before the method',
      'Friendly step-by-step instructions',
      'Useful tips & storage notes',
    ],
  },
} as const;
export const stages = [
  'Analysing recording',
  'Extracting key frames',
  'Identifying process steps',
  'Writing document content',
  'Verifying and finalising',
];
export const initialWizard: WizardData = {
  category: 'education',
  docType: 'Lab report',
  evidence: [],
  references: [],
  brief: '',
  templateMode: 'builtin',
  templateFile: null,
  mappings: [],
  settings: {
    'Capture on change': true,
    'Drop near-identical frames': true,
    'Split long recordings': true,
    'Flag sensitive data': true,
    'Analyse with Gemini': true,
  },
};
export function makeDemoDocument(category: Category, docType: string): DocumentData {
  const content: Record<Category, string[]> = {
    education: [
      '<p>This sample report documents the determination of a spring constant using Hooke’s law. The objective is to investigate the relationship between applied force and extension.</p>',
      '<p>A retort stand, spring, ruler and slotted masses are required. The spring is suspended vertically beside the ruler. The initial position is recorded before loading.</p>',
      '<p>The apparatus was assembled as shown in Figure 1. Masses were added incrementally and the extension was recorded after the spring came to rest.</p><ol><li>Record the unloaded spring position.</li><li>Add each mass and observe the extension.</li><li>Repeat measurements to assess consistency.</li></ol>',
      '<p>Plot applied force against extension. The gradient of the linear region represents the spring constant. No numerical results are provided in this sample; enter your measured values before submission.</p>',
      '<p>The relationship between force and extension should be assessed from the measured data. Discuss measurement uncertainty and the limits of the experimental method.</p>',
      '<p>Add the course handbook, experiment instructions and any sources consulted. This demonstration does not supply real references.</p>',
    ],
    work: [
      '<p><strong>Document no:</strong> SOP-DEMO-001 · <strong>Version:</strong> 1.0</p><p>Use this sample procedure to demonstrate how a repeatable equipment inspection can be documented. Confirm the scope and responsible owner before use.</p>',
      '<p><strong>CAUTION:</strong> Follow the approved safety procedure. Use the appropriate PPE and confirm the equipment is isolated before inspection. This sample is not an approved operating instruction.</p>',
      '<ol><li>Check the equipment identity against the work order.</li><li>Inspect the equipment visually and record the findings.</li><li>Refer any abnormal condition to the responsible supervisor.</li></ol>',
      '<p><strong>Checkpoint:</strong> Record the inspection result and obtain supervisor approval. Do not resume operation until the applicable checks are complete.</p>',
      '<p>Version 1.0 — demonstration draft. Add the document owner, approver, effective date and escalation contact.</p>',
    ],
    personal: [
      '<p>A simple, shareable cookie recipe example. This sample shows how a recording can become a guide; check your own quantities and timing before cooking.</p>',
      '<ul><li>Flour and butter</li><li>Sugar and eggs</li><li>Chocolate chips</li><li>Mixing bowl and baking tray</li></ul><p>Add the exact quantities and serving size from your recipe.</p>',
      '<ol><li>Prepare your ingredients and line the baking tray.</li><li>Mix the butter and sugar, then add the egg.</li><li>Fold in the dry ingredients and chocolate chips.</li><li>Shape the dough and bake using your tested temperature and timing.</li></ol>',
      '<p>Keep the dough portions similar in size so they bake evenly. Note any substitutions you have tested, and identify allergens clearly.</p>',
      '<p>Let the cookies cool before storing. Add your tested storage guidance and shelf life.</p>',
    ],
  };
  const title =
    category === 'education'
      ? 'Determination of the spring constant'
      : category === 'work'
        ? 'Equipment inspection procedure'
        : 'Homemade chocolate chip cookies';
  const sections = categories[category].sections.map((heading, i) => ({
    id: `s-${i}`,
    heading: `${i + 1}.0 ${heading}`,
    html: content[category][i],
    blocks:
      i === 2
        ? [
            {
              type: 'figure' as const,
              id: 'fig-1',
              frameId: 'demo-frame-01',
              caption:
                category === 'education'
                  ? 'Figure 1: Experimental setup (illustrative demo)'
                  : 'Step 01 — Sample process illustration',
              checkpoint:
                category === 'work' ? 'Confirm the setup with the approved procedure.' : null,
              annotated: false,
              fileUrl: '/assets/demo-evidence.svg',
            },
          ]
        : [],
    flags:
      i === 2
        ? [
            {
              id: 'flag-1',
              level: 'unverified',
              text: 'A transition between two actions is not visible in this sample. Review the original evidence before using this instruction.',
              frames: ['demo-frame-01', 'demo-frame-02'],
            },
          ]
        : [],
  }));
  return {
    category,
    docType,
    title,
    meta: { date: new Date().toISOString().slice(0, 10), status: 'Demonstration draft' },
    sections,
    validation: { steps: 4, figures: 1, verified: 3, flagged: 1 },
    missing: ['Demo content is pre-written and does not analyse your uploaded files.'],
  };
}
