// This file acts as a secure proxy to the Gemini API with Google Search grounding.
// It is designed to be deployed to a serverless platform like Vercel.

// The GEMINI_API_KEY is stored securely as an environment variable on Vercel.
const apiKey = process.env.GEMINI_API_KEY; 

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
            myName, myRole, myServices, myCompanyName, myCompanyWebsite,
            customerName, customerCompany, customerWebsite, customerLinkedinProfile, 
            customerPersonalityType, competitorSolution, messageLength, currentLang 
        } = req.body;

        // --- 1. Perform Google Search for Customer Context ---
        
        let searchContext = "";
        
        // Define key search queries for role/challenges
        const searchQueries = [];
        if (customerLinkedinProfile) {
            searchQueries.push(`site:linkedin.com/in/ ${customerName}`);
        }
        if (customerWebsite) {
             searchQueries.push(`${customerCompany} strategic priorities`);
             searchQueries.push(`${customerCompany} challenges`);
        } else {
             // Fallback search if no specific URL is provided
             searchQueries.push(`${customerCompany} top challenges`);
        }

        // Only call the Google Search API if there are queries
        if (searchQueries.length > 0) {
            // Note: The google_search tool is assumed to be available in the Vercel environment
            const searchResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Search for information related to: ${searchQueries.join('; ')}` }] }],
                    tools: [{ "google_search": {} }]
                })
            });
            
            if (searchResponse.ok) {
                const searchResult = await searchResponse.json();
                
                // Extract search sources and format them for the prompt
                const groundingAttributions = searchResult.candidates?.[0]?.groundingMetadata?.groundingAttributions || [];
                
                if (groundingAttributions.length > 0) {
                    searchContext = groundingAttributions.map((attr, index) => 
                        `Source ${index + 1}: ${attr.web?.title || 'No Title'} - Snippet: ${attr.web?.snippet || 'No Snippet'}`
                    ).join('\n---\n');
                }
            }
        }

        // --- 2. Construct the Final Prompt for the AI Agent ---
        
        const highlightsList = companyData[myCompanyName]?.highlights ? companyData[myCompanyName].highlights.map(h => `- ${h}`).join('\n') : productHighlights.map(h => `- ${h}`).join('\n');

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

            The final output MUST be in ${currentLang} language, based on the user's explicit request.

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
            - My Company's Name: ${myCompanyName}
            - My Company's Website: ${myCompanyWebsite}
            - My Company's Core Services/Value Proposition: ${myServices}
            - My Company's Key Highlights: ${highlightsList}

            Customer Information:
            - Customer Name: ${customerName}
            - Customer Business: ${customerCompany}
            - Customer LinkedIn/Role: ${customerLinkedinProfile}
            - Customer Personality Type: ${customerPersonalityType || 'Not specified'}
            - Competitor Solution (currently used): ${competitorSolution || 'Not specified'}

            Google Search Context on Customer and Industry Challenges:
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
