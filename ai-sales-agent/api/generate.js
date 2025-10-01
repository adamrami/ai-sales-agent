// This file acts as a secure proxy to the Gemini API with Google Search grounding.
// It is designed to be deployed to a serverless platform like Vercel.

// The GEMINI_API_KEY is stored securely as an environment variable on Vercel.
const apiKey = process.env.GEMINI_API_KEY; 

// STATIC DATA (Moved from index.html to be accessible on the server)
const companyData = {
    "IFS": {
        name: "IFS",
        website: "https://www.ifs.com",
        highlights: [
            "A single, unified cloud platform for ERP, Enterprise Asset Management (EAM), and Field Service Management (FSM).",
            "Industry-specific solutions tailored for industries like manufacturing, construction, energy, and aerospace.",
            "Advanced project management capabilities with real-time tracking, resource allocation, and cost control.",
            "Robust supply chain management to optimize inventory, procurement, and logistics.",
            "Mobile-first design for field technicians and a user-friendly, adaptable interface.",
            "Built-in analytics and business intelligence for data-driven decision making.",
            "Servitization enablement to help companies transition from selling products to selling services."
        ]
    },
    "SAP": {
        name: "SAP S/4HANA",
        website: "https://www.sap.com/products/s4hana-erp.html",
        highlights: [
            "An intelligent, integrated ERP system that runs on an in-memory database to enable real-time decision-making.",
            "Combines traditional ERP with advanced technologies like AI and machine learning.",
            "Provides a comprehensive suite of business applications for finance, supply chain, and more.",
            "Known for its deep functionality and a wide array of modules for complex business processes.",
            "Helps large enterprises manage global operations and scale across various industries.",
            "Focuses on a streamlined digital core with simplified data models."
        ]
    },
    "Oracle": {
        name: "Oracle Cloud ERP",
        website: "https://www.oracle.com/erp/",
        highlights: [
            "A complete and modern ERP system with built-in AI, machine learning, and advanced analytics.",
            "Provides a full suite of applications for finance, procurement, project management, and risk management.",
            "Offers continuous innovation with quarterly updates and a modern user interface.",
            "Known for its strong financial management and robust reporting capabilities.",
            "Helps businesses automate processes, increase agility, and gain a competitive advantage.",
            "Provides a unified data model for a single source of truth across the enterprise."
        ]
    },
    "Other": {
        name: "",
        website: "",
        highlights: [
            "A comprehensive business solution designed to streamline your operations and drive growth.",
            "Integrates key business functions like finance, operations, and supply chain management on a single platform.",
            "Provides real-time visibility and data-driven insights to support smarter decision-making.",
            "Offers a flexible and scalable architecture that adapts to your unique industry and business needs.",
            "Automates routine tasks and workflows to boost efficiency and productivity.",
            "Features a user-centric design that enhances user adoption and simplifies complex processes."
        ]
    }
};

const competitorData = {
    "IFS": "SAP, Oracle, Microsoft Dynamics 365, Infor",
    "SAP": "Oracle, Microsoft Dynamics 365, IFS, Infor",
    "Oracle": "SAP, Microsoft Dynamics 365, IFS, Workday",
    "Other": ""
};


export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Ensure the API key is set
    if (!apiKey) {
        return res.status(500).json({ error: 'Server configuration error: API key not set (GEMINI_API_KEY environment variable is missing).' });
    }

    try {
        // Destructure all necessary inputs from the frontend
        const { 
            myName, myRole, myServices, myCompanySelect, 
            customerName, customerCompany, customerWebsite, customerLinkedinProfile, 
            customerPersonalityType, competitorSolution, messageLength, currentLang,
            sourceCompanyName, sourceCompanyWebsite, annualReportUrl 
        } = req.body;

        // --- SAFE DATA HANDLING ---
        // Ensure selectedCompanyData is a valid object, defaulting to 'Other' if necessary
        const companyKey = myCompanySelect && companyData[myCompanySelect] ? myCompanySelect : 'Other';
        const selectedCompanyData = companyData[companyKey];

        // Determine final company data based on selection or custom input
        // Note: The logic handles if a user selects 'Other' but leaves the custom fields blank.
        const finalCompanyName = myCompanySelect === 'Other' && sourceCompanyName ? sourceCompanyName : selectedCompanyData.name;
        const finalCompanyWebsite = myCompanySelect === 'Other' && sourceCompanyWebsite ? sourceCompanyWebsite : selectedCompanyData.website;
        const productHighlights = selectedCompanyData.highlights;


        // --- 1. Perform Google Search for Customer Context ---
        
        let searchContext = "";
        
        // Define key search queries for role/challenges
        const searchQueries = [];
        
        // Search for specific role information (if LinkedIn or name is provided)
        if (customerLinkedinProfile) {
            searchQueries.push(`site:linkedin.com/in/ ${customerName} title`);
        } else if (customerName && customerCompany) {
            searchQueries.push(`role of ${customerName} at ${customerCompany}`);
        }
        
        // Search for company challenges and priorities
        if (customerCompany) {
             searchQueries.push(`${customerCompany} strategic priorities`);
             searchQueries.push(`${customerCompany} challenges`);
        } else if (customerWebsite) {
             searchQueries.push(`${customerWebsite} strategic goals`);
             searchQueries.push(`${customerWebsite} current challenges`);
        }

        // Add Annual Report search query if provided
        if (annualReportUrl) {
            searchQueries.push(`${annualReportUrl} goals AND challenges`);
        }

        // Only call the Google Search API if there are queries
        if (searchQueries.length > 0) {
            const searchResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Search for the following commercial information: ${searchQueries.join('; ')}` }] }],
                    tools: [{ "google_search": {} }]
                })
            });
            
            if (searchResponse.ok) {
                const searchResult = await searchResponse.json();
                
                // Extract search sources and format them for the prompt
                const groundingAttributions = searchResult.candidates?.[0]?.groundingMetadata?.groundingAttributions || [];
                
                if (groundingAttributions.length > 0) {
                    searchContext = groundingAttributions.map((attr, index) => 
                        `Source ${index + 1} - Title: ${attr.web?.title || 'No Title'} - Snippet: ${attr.web?.snippet || 'No Snippet'}`
                    ).join('\n---\n');
                }
            }
        }

        // --- 2. Construct the Final Prompt for the AI Agent ---
        
        const highlightsList = productHighlights.map(h => `- ${h}`).join('\n');

        let lengthConstraint = '';
        if (messageLength === 'short') {
            lengthConstraint = 'Be very concise, around 50-75 words.';
        } else if (messageLength === 'moderate') {
            lengthConstraint = 'Be moderate in length, around 120-180 words.';
        } else if (messageLength === 'detailed') {
            lengthConstraint = 'Be comprehensive and detailed, around 200-300 words.';
        } else { 
            lengthConstraint = 'Vary the length and structure of each email to provide different options.';
        }

        const systemInstruction = `
            You are a world-class sales agent specializing in B2B enterprise solutions. Your goal is to generate three highly personalized email drafts in three distinct tones: Professional, Engaging, and Relaxed.

            The final output MUST be in ${currentLang} language.

            Your pitch must be tailored based on the customer's role and challenges, using the provided context and the search results.

            Crucial Tasks:
            1. Role Analysis: Infer the customer's executive role (e.g., CFO, Head of Supply Chain) based on the customer's name, company, and search context.
            2. Value Alignment: Align the pitch (My Company's Value Proposition) directly with the typical priorities of that identified role (e.g., CFO prioritizes ROI, Head of Ops prioritizes efficiency).
            3. Competitor Differentiator: Briefly mention why the user's service is superior to the mentioned competitor, if provided.
            4. Tone & Length: Adhere to the requested tone and length constraint.

            Formatting:
            - The email body MUST be formatted using HTML tags (like <p>, <strong>, <br>) for professional presentation.
            - The final response MUST be a valid JSON array of three objects.
        `;

        const userPrompt = `
            My Information:
            - My Name: ${myName}
            - My Role: ${myRole}
            - My Company's Name: ${finalCompanyName}
            - My Company's Website: ${finalCompanyWebsite}
            - My Company's Core Services/Value Proposition: ${myServices}
            - My Company's Key Highlights: ${highlightsList}

            Customer Information:
            - Customer Name: ${customerName}
            - Customer Business: ${customerCompany}
            - Customer LinkedIn/Role: ${customerLinkedinProfile}
            - Customer Personality Type: ${customerPersonalityType || 'Not specified'}
            - Competitor Solution (currently used): ${competitorSolution || 'Not specified'}

            Google Search Context on Customer and Industry Challenges (Use this to find role and challenges):
            ---
            ${searchContext || 'No external search context was found.'}
            ---

            Constraints:
            - Output Language: ${currentLang}
            - Message Length: ${lengthConstraint}
            
            Generate the JSON array now.
        `;
        
        // --- 3. Call Gemini API ---

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: systemInstruction,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            "tone": { "type": "STRING" },
                            "subject": { "type": "STRING" },
                            "body": { "type": "STRING" }
                        }
                    }
                }
            }
        };

        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.json();
            throw new Error(`Gemini API Error: ${geminiResponse.status} ${geminiResponse.statusText} - ${JSON.stringify(errorData)}`);
        }

        const data = await geminiResponse.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Error in API proxy:', error);
        res.status(500).json({ error: error.message });
    }
}
