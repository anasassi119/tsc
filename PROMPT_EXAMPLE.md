# Template UI Creation Prompt

[UI_CREATION OUTPUT].

# Tech Stack
- Use LATEST [Technologies specified by user]
- Use reusable components.
- DO NOT HARDCODE ANY COMPONENT ANYWHERE. EVERY COMPONENT USED IN THE SYSTEM MUST BE REUSABLE AND RESPONSIVE.
- Do NOT use emojis, unless explicitly asked.
- For animations, use [Technologies specified by user].
- [OPTIONAL] For 3D Illustrations, use t[Technologies specified by user]
- [OPTIONAL] Use [Technologies specified by user] for CMS
- [OPTIONAL] Use [Technologies specified by user] for authentication(users can’t sign up, only admin can, and they can add users)

# Pages
- [Page]: [Description]
- [Page]: ..
- etc, etc..

# Branding
- Our colors are: [PrimaryColor], [SecondaryColor], ….
- Use [Font] Font.

# Standards
- UI must be Responsive on all screen sizes.
- UI must support BOTH Left-to-Right and Right-to-Left layouts. Because of this rule, take into account how margins, layouts, and padding is managed in styling.
- UI must support Localization using i18next.
- Loading state must be a SKELETON of the component/page being loaded. Don’t be lazy. SKELETON LOADER IS A REQUIREMENT.
- Incorporate SEO best practices, relevant GA4 tags, and wiring for GA4 analytics tag, sitemap.xml, robots.txt, index.html tags, keywords, description, GDPR Cookies Consent dialog, etc, etc..
- Ensure support for all modern browsers, particularly, webkit browsers, firefox, and chromium when designing EVERY aspect of the website, including but not limited to animations, effects, and layouts
- Always use the latest version of all packages, do NOT use older or deprecated versions of any package, library, or framework. Use any tools available to check, or install the latest by default.
- AVOID GRADIENTS, AVOID UNNECESSARY BANNERS, AVOID BEING UNNECESSARILY DESCRIPTIVE
- EVERYTHING YOU GENERATE MUST BE HUMAN-LIKE. DO NOT ACT LIKE AN AI. DO NOT DESIGN LIKE AN AI. ADHERE, TO THE FULLEST EXTENT, TO THE STYLE PROVIDED.


—— [OPTIONAL] ——

# Development Approach: Test-Driven Development.
* Implement Every feature using the Red-Green-Refactor cycle.
* Workflow Constraints: Do not provide the full solution at once, Pause and wait for my "Proceed" command after every sub-step.
* RED: Write one failing test for the smallest possible unit of logic. Explain the failure. Pause.
* GREEN: Write the absolute minimum code to pass that specific test. No optimization. Pause.
* REFACTOR: Clean the code and remove duplication while keeping the test green. Pause.
* Your Initial Goal for every feature is to provide the first RED test case.
