/* =====================================================================
   sample.js — the starting CV
   ---------------------------------------------------------------------
   This is the data the builder loads the first time (and on "Reset").
   Everything the preview shows comes from an object shaped like this.

   Section types:
   - 'academic'     → the Degree / Institute / %CGPA / Year table
   - 'experience'   → company/project blocks with a category column
                      ("Roles & Responsibilities", "Achievements") + bullets
   - 'categorized'  → category column + bullets, optional Year column
                      (Positions of Responsibility, Awards …)

   Text wrapped in **double stars** prints in bold.
   ===================================================================== */

const SAMPLE_CV = {
  "personal": {
    "name": "Mayank Malviya",
    "line1": "Male, 25 years",
    "line2": "MBA, Batch 25 - 27",
    "logo": "assets/iim-mumbai-logo.png"
  },
  "headline": "TCPL National Winner | Customer Retention Strategist | Analytics-to-GTM Builder | Bibliophile",
  "footer": "www.linkedin.com/in/mayankmalviya64",
  "sections": [
    {
      "type": "academic",
      "title": "Academic Profile",
      "columns": [
        "Degree",
        "Institute",
        "%/CGPA",
        "Year"
      ],
      "rows": [
        [
          "MBA",
          "Indian Institute of Management, Mumbai",
          "Pursuing",
          "2027"
        ],
        [
          "B.Tech (Chemical Science & Technology)",
          "Indian Institute of Technology Guwahati",
          "70.40%",
          "2022"
        ],
        [
          "Class XII",
          "Chhatrapati Shivaji Children Secondary School, Kota",
          "71.40%",
          "2018"
        ],
        [
          "Class X",
          "Tara Sadan Higher Secondary School, Ashoknagar",
          "93.10%",
          "2016"
        ]
      ]
    },
    {
      "type": "experience",
      "title": "Summer Internship",
      "note": "12 Weeks",
      "entries": [
        {
          "org": "Motilal Oswal Financial Services Ltd.",
          "role": "Product Growth & Strategy Intern",
          "dates": "Apr’26-May’26",
          "subtitle": "Project Title: Customer Retention: Analytics, Customer Insights & Initiatives",
          "duration": "",
          "groups": [
            {
              "label": "Roles &\nResponsibilities",
              "bullets": [
                {
                  "text": "Enabled FT impact evaluation across 4 MAU buckets via product analytics KPIs, pain point research and Databricks SQL"
                },
                {
                  "text": "Enhanced **CRM** personalization via **7-persona SQL model** powering product discovery, prioritization & **GTM** strategy"
                },
                {
                  "text": "Enabled automated monthly MIS refresh via unified SQL table consolidating demographics, app & calling-behaviour data"
                }
              ]
            },
            {
              "label": "Achievements",
              "bullets": [
                {
                  "text": "Identified **M1** drop as primary churn driver via structured RCA & **30% M12** industry benchmark shaping FY26 strategy"
                },
                {
                  "text": "Derived **15+ churn** insights through hypothesis-driven root cause analysis for retained-vs-churned cohort of **50K+ users**"
                },
                {
                  "text": "Architected **hyperpersonalization** based behavioral analytics model automating execution of threshold deviation triggers"
                }
              ]
            }
          ]
        },
        {
          "org": "Motilal Oswal Financial Services Limited",
          "role": "Product Growth & Strategy Intern",
          "dates": "Apr’26-May’26",
          "subtitle": "Project Title: Multi-Channel Campaign-to-Revenue Attribution & Conversion Funnel Analytics",
          "duration": "",
          "groups": [
            {
              "label": "Roles &\nResponsibilities",
              "bullets": [
                {
                  "text": "Mapped **94M+** push impressions to trade-level brokerage in Databricks SQL, using **T+0/4** revenue attribution windows"
                },
                {
                  "text": "Improved attribution accuracy for **Hyper Alert** campaign re-engagement, flagging clicked-but-not-traded user drop-offs"
                },
                {
                  "text": "Boosted CTR comparability across **20+** campaigns via cross-channel funnel analysis & **Push-InApp** event normalisation"
                }
              ]
            },
            {
              "label": "Achievements",
              "bullets": [
                {
                  "text": "Optimized query run time by scanning **precise 5-10%** of data via **3-tier** data mart on **30+ events**, client & monthly split"
                },
                {
                  "text": "Quantified ₹10 Cr+ CDP brokerage revenue via Databricks attribution model, enabling product-KPI & revenue tracking"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "experience",
      "title": "Projects",
      "note": "",
      "entries": [
        {
          "org": "Indian Institute of Management Mumbai",
          "role": "",
          "dates": "Aug’26-Aug’26",
          "subtitle": "Project Title: High Customer DSAT Scores with Web Based Digital Services",
          "duration": "3 Weeks",
          "groups": [
            {
              "label": "Project Details",
              "bullets": [
                {
                  "text": "Diagnosed an **8 month** contractual DSAT across **325** agent and ticket records using Anova, Cramer’s V and Tukey HSD"
                },
                {
                  "text": "Led **DMAIC** root cause study via **Fishbone, 5 Whys, FMEA, Pareto, I-MR** capability, sizing the baseline at **0.9 sigma**"
                },
                {
                  "text": "Quantified Cost of Poor Quality at **USD 4.58M** annually and built a **3-year** business case for a **USD 2.57M** programme"
                },
                {
                  "text": "Built & deployed a **9 Module** Interactive DSAT simulator on GitHubPages with live recomputation of all scenario levers"
                }
              ]
            },
            {
              "label": "Achievements",
              "bullets": [
                {
                  "text": "Established **contact count** as the driver of **88%** of satisfaction variance and support tenure as a variable misdirecting plans"
                },
                {
                  "text": "Derived a transfer function turning lagging DSAT into a steerable **81 to 88%** FCR target via **7 initiatives** & an SPC plan"
                },
                {
                  "text": "Projected **203% ROI**, at **USD 3.92M NPV** and payback in month **12**, with **CoPQ at 62.8%** of the contract value today",
                  "hidden": true
                }
              ]
            }
          ]
        },
        {
          "org": "",
          "role": "",
          "dates": "",
          "subtitle": "Project Title: Strategy for Market-Share Increase",
          "duration": "3 Weeks",
          "groups": [
            {
              "label": "Project Details",
              "bullets": [
                {
                  "text": "Diagnosed a footwear brand’s **8%** share gap in **8 NE** states via PESTEL, SWOT, Porter’s Five Forces, 3C and an issue tree"
                },
                {
                  "text": "Strategised a **4-line** regional product architecture tilted to all-weather sports, adding an ethnic capsule made with artisans"
                },
                {
                  "text": "Forecasted a **3-year** financial model for a **₹24 Crore** self-funded regional expansion, with **₹165** CAC and **₹1,822** LTV"
                },
                {
                  "text": "Formulated a **3-phase**, gate driven **GTM** and resilience plan with a **7 risk** mitigation matrix and capital light fallback plan"
                }
              ]
            },
            {
              "label": "Achievements",
              "bullets": [
                {
                  "text": "Sized a **₹3,600 Cr** TAM and **₹880 Cr** SAM, benchmarked **5 KPIs** isolating coverage, logistics & localisation constraint",
                  "hidden": true
                },
                {
                  "text": "Designed **55:38:7** value, mid & premium tier pricing mix to penetrate **40%** of unorganised market across Northeast India"
                },
                {
                  "text": "Projected **4.6:1** LTV to CAC, regional revenue from **₹14 Cr-₹46 Cr** and market share from **8% to 15%** in **36 months**"
                },
                {
                  "text": "Cut target lead time from **4.5** to **3 days** via a regional distribution hub, AI-led demand forecasting and route optimisation"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "categorized",
      "title": "Positions of Responsibility",
      "showYear": true,
      "groups": [
        {
          "label": "Class\nRepresentative\n(IIM Mumbai)",
          "bullets": [
            {
              "text": "Drove core process redesign for **150+** peers swapping traditional pen-paper exam with **capstone**-based evaluation",
              "year": "2026"
            },
            {
              "text": "Enhanced scheduling & material sharing for students across **10** courses via stakeholder-aligned workflow redesign",
              "year": "2026"
            },
            {
              "text": "Strengthened issue-resolution cadence closing 100+ academic concerns under-24hr TAT via prioritised escalation",
              "year": "2026"
            }
          ]
        },
        {
          "label": "Project Head (Aero\nClub | IITG)",
          "bullets": [
            {
              "text": "Mentored **8** projects with **45+** students and ensured successful demos during **TechEvince**, IITG’s flagship expo",
              "year": "2021"
            },
            {
              "text": "Implemented **robust** project **oversights** by establishing **timelines**, tracking **milestones**, and enforcing deadlines",
              "year": "2021"
            },
            {
              "text": "Oversaw resource **optimization**, balancing **budget** and **assets** to meet project objectives **without** cost **overruns**",
              "year": "2021"
            }
          ]
        },
        {
          "label": "Secretary (Marketing Interest Group)",
          "bullets": [
            {
              "text": "Drove **46%** rise in **intent** applications by spearheading committee **rebranding**-name, logo, structure and website",
              "year": "2026"
            },
            {
              "text": "Hosted **P&G-Meta** UGC workshop, Starbucks & Adobe leadership talk & Unstop contest reaching **50K+** views",
              "year": "2026"
            },
            {
              "text": "Authored **80+** page case-led **marketing compendium** on positioning, portfolio and pricing for **1000+** students",
              "year": "2026"
            },
            {
              "text": "Secured **₹1.2L+** in prizes & sponsorships & **12** Live projects via **B2B** negotiations, facilitated signing of **3 MoUs**",
              "year": "2026"
            }
          ]
        }
      ]
    },
    {
      "type": "categorized",
      "title": "Awards and Achievements",
      "showYear": true,
      "groups": [
        {
          "label": "Corporate Events",
          "bullets": [
            {
              "text": "National Winner for **Tata Consumer** Products Ltd (TCPL) Grow Beyond Better outperforming **14,000+** peers",
              "year": "2026"
            },
            {
              "text": "National Finalist for **Thouccentric & Xoriant** Bottoms Up 5.0-AI for Consulting placing among **top 15** teams",
              "year": "2026"
            },
            {
              "text": "Campus Finalist for **Axis Moves’26** by Axis Bank, ranked among **top 5%** within a pool of **42,000+** participants",
              "year": "2026"
            },
            {
              "text": "Campus Finalist for **Marico Over The Wall**, placed in **top 0.6%** among a pool of **28,000+** registered candidates",
              "year": "2026"
            }
          ]
        },
        {
          "label": "B-School Events",
          "bullets": [
            {
              "text": "**National Winner** for Prachaar 3.0 marketing case study competition by **Goa Institute of Management (GIM)**",
              "year": "2026"
            }
          ]
        },
        {
          "label": "Academics",
          "bullets": [
            {
              "text": "Spearheaded research on **CO₂ sequestration** with MOFs securing **AA** for pioneering **sustainability** approaches",
              "year": "2022"
            },
            {
              "text": "Attained **AA** in **Economic Development** for policy-driven analysis of **India’s growth trajectory** (1947-2011)",
              "year": "2021"
            }
          ]
        },
        {
          "label": "Certifications",
          "bullets": [
            {
              "text": "Successfully acquired UiPath Academic Alliance Student **Agentic Automation Associate** certification by **PwC**",
              "year": "2025"
            },
            {
              "text": "Acquired certification of **Lean Six Sigma Green Belt** online from Advanced Innovation Group Pro Excellence",
              "year": "2025"
            }
          ]
        },
        {
          "label": "Extra-Curriculars",
          "bullets": [
            {
              "text": "Ranked **5th** among **125+** teams in Business Prodigy **Consulting Olympiad** demonstrating **strategic** excellence",
              "year": "2025"
            },
            {
              "text": "Delivered **40+ hrs** teaching to **100+** rural kids with DISHA IITG imbuing conceptual clarity & **self-confidence**",
              "year": "2020"
            }
          ],
          "hidden": true
        }
      ]
    }
  ]
};

/** Empty building blocks used by the "+ Add" buttons. */
const BLANKS = {
  bullet: (withYear) => (withYear ? { text: '', year: '' } : { text: '' }),
  group: (label, withYear) => ({ label: label || 'Category', bullets: [BLANKS.bullet(withYear)] }),
  entry: () => ({
    org: 'Organisation', role: 'Role', dates: 'Mon’YY-Mon’YY',
    subtitle: 'Project Title: ', duration: '',
    groups: [BLANKS.group('Roles &\nResponsibilities'), BLANKS.group('Achievements')],
  }),
  section: (type) => {
    if (type === 'academic') {
      return { type, title: 'Academic Profile', columns: ['Degree', 'Institute', '%/CGPA', 'Year'], rows: [['', '', '', '']] };
    }
    if (type === 'experience') {
      return { type, title: 'New Experience Section', note: '', entries: [BLANKS.entry()] };
    }
    return { type: 'categorized', title: 'New Section', showYear: true, groups: [BLANKS.group('Category', true)] };
  },
};
