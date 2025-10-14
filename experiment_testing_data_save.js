// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let revealedWords = new Set();
let startTime = null;
let clickTimes = [];
let randomSeed = null;
let totalPoints = 100; // Starting points
const POINTS_PER_REVEAL = 3; // Points lost per word reveal
let completedTrials = []; // Store completed trial data

// Articles that should not be obscured
const articles = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

// Get URL parameters
function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Seeded random number generator (for reproducible randomization)
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    // Linear congruential generator
    next() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
    
    // Shuffle array using Fisher-Yates with seeded random
    shuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

// Determine which sublist to use based on URL parameter
const sublistParam = getURLParameter('sublist');
let sublistNumber = 1; // default

if (sublistParam) {
    const parsed = parseInt(sublistParam);
    if (parsed >= 1 && parsed <= 4) {
        sublistNumber = parsed;
    } else {
        console.warn(`Invalid sublist parameter: ${sublistParam}. Using default sublist 1.`);
    }
}

// Get random seed from URL parameter (for trial randomization)
const seedParam = getURLParameter('seed');
if (seedParam) {
    randomSeed = parseInt(seedParam);
    if (isNaN(randomSeed)) {
        // If seed is not a number, convert string to number
        randomSeed = seedParam.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    }
} else {
    // Generate random seed if not provided
    randomSeed = Math.floor(Math.random() * 1000000);
}

console.log(`Using sublist: ${sublistNumber}`);
console.log(`Using random seed: ${randomSeed}`);

const csvFilename = `trial_list_sublist_${sublistNumber}.csv`;

// Initialize jsPsych
const jsPsych = initJsPsych({});

// Initialize filename based on subjCode, sublist, and seed
const subjCode = getURLParameter('subjCode');
const filename = `${subjCode}_sublist${sublistNumber}_seed${randomSeed}.csv`;

// Function to update points display
function updatePointsDisplay(points) {
    const pointsElement = document.getElementById('points-counter');
    if (pointsElement) {
        pointsElement.textContent = `Points: ${points}`;
        // Add visual feedback for point loss
        pointsElement.style.color = '#d32f2f';
        setTimeout(() => {
            pointsElement.style.color = '#333';
        }, 300);
    }
}

// Function to tokenize sentence into words and punctuation
function tokenizeSentence(sentence) {
    // Split on spaces and punctuation, keeping punctuation as separate tokens
    const tokens = [];
    const words = sentence.split(' ');
    
    words.forEach(word => {
        // Match word and trailing punctuation separately
        const match = word.match(/^([^.,!?;:'"]*)([.,!?;:'"]*)$/);
        if (match) {
            const [, wordPart, punctPart] = match;
            if (wordPart) tokens.push(wordPart);
            if (punctPart) {
                // Add each punctuation mark as separate token
                punctPart.split('').forEach(p => tokens.push(p));
            }
        } else {
            tokens.push(word);
        }
    });
    
    return tokens;
}

// Function to find target word index in tokenized sentence
function findTargetWordIndex(tokens, targetWord, targetWordPosition) {
    const cleanTarget = targetWord.toLowerCase().replace(/[.,!?;:'"]/g, '');
    
    // If targetWordPosition is provided and valid, use it to find the nth word token
    if (targetWordPosition !== null && targetWordPosition !== undefined && targetWordPosition !== '') {
        const posNum = typeof targetWordPosition === 'string' ? parseInt(targetWordPosition) : targetWordPosition;
        
        if (!isNaN(posNum) && posNum >= 0) {
            let wordCount = 0;
            for (let i = 0; i < tokens.length; i++) {
                // Skip punctuation tokens
                if (!/^[.,!?;:'"]$/.test(tokens[i])) {
                    if (wordCount === posNum) {
                        return i;
                    }
                    wordCount++;
                }
            }
            console.warn(`Could not find word at position ${posNum}, falling back to text search`);
        }
    }
    
    // Fall back to searching for the target word by text
    for (let i = 0; i < tokens.length; i++) {
        // Skip punctuation tokens
        if (!/^[.,!?;:'"]$/.test(tokens[i])) {
            const cleanToken = tokens[i].toLowerCase().replace(/[.,!?;:'"]/g, '');
            if (cleanToken === cleanTarget) {
                return i;
            }
        }
    }
    
    console.error(`Could not find target word '${targetWord}' in sentence`);
    return -1;
}

// Function to load and randomize CSV data
function loadTrialData() {
    return new Promise((resolve, reject) => {
        Papa.parse(csvFilename, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: function(results) {
                console.log('Loaded CSV data:', results.data);
                
                if (results.data.length === 0) {
                    reject(new Error('CSV file is empty'));
                    return;
                }
                
                const requiredColumns = ['passage_variant', 'jabber_passage', 'target_word'];
                const firstRow = results.data[0];
                const missingColumns = requiredColumns.filter(col => !(col in firstRow));
                
                if (missingColumns.length > 0) {
                    reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
                    return;
                }
                
                // Store original data
                const originalData = results.data;
                
                // Randomize trial order using seeded random
                const rng = new SeededRandom(randomSeed);
                trialData = rng.shuffle(originalData);
                
                console.log(`Successfully loaded ${trialData.length} trials from sublist ${sublistNumber}`);
                console.log(`Randomized with seed ${randomSeed}`);
                
                // Log first few for debugging
                console.log('First trial structure:', trialData[0]);
                
                resolve();
            },
            error: function(error) {
                console.error('Error loading CSV:', error);
                reject(error);
            }
        });
    });
}

// Function to create word reveal trial
function createWordRevealTrial(trialIndex) {
    const trial = trialData[trialIndex];
    
    // Parse the passages
    const realSentence = trial.passage_variant || trial.ground_truth_sentence || '';
    const jabberSentence = trial.jabber_passage || trial.nonsense_sentence || '';
    
    // Tokenize sentences (separating words and punctuation)
    const realTokens = tokenizeSentence(realSentence);
    const jabberTokens = tokenizeSentence(jabberSentence);
    
    // Get target word and find its position
    const targetWord = trial.target_word;
    const targetWordPosition = trial.target_word_position; // Added by preprocessing script
    
    const targetIndex = findTargetWordIndex(jabberTokens, targetWord, targetWordPosition);
    
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    // Validation
    if (targetIndex < 0 || targetIndex >= jabberTokens.length) {
        console.error(`Invalid target index ${targetIndex} for trial ${originalTrialNumber}`);
    }
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function() {
            currentTrial = trial;
            revealedWords.clear();
            startTime = Date.now();
            clickTimes = [];
            
            let html = `
                <div style="position: relative;">
                    <div class="trial-counter">Trial ${trialNumber} of ${trialData.length}</div>
                    <div class="points-counter" id="points-counter">Points: ${totalPoints}</div>
                    <div class="sentence-container" id="sentence-container">
            `;
            
            // Build sentence token by token
            for (let index = 0; index < jabberTokens.length; index++) {
                const token = jabberTokens[index];
                
                // Check if this token is punctuation
                if (/^[.,!?;:'"]$/.test(token)) {
                    // Punctuation - just display it without any special styling
                    html += token;
                    // Add space after certain punctuation
                    if (/[.,!?;:]/.test(token) && index < jabberTokens.length - 1) {
                        html += ' ';
                    }
                    continue;
                }
                
                let wordClass = 'word';
                let displayWord = token;
                
                // Clean token for comparison
                const cleanJabber = token.toLowerCase().replace(/[.,!?;:'"]/g, '');
                const cleanReal = index < realTokens.length ? realTokens[index].toLowerCase().replace(/[.,!?;:'"]/g, '') : '';
                
                if (index === targetIndex) {
                    // This is the target word
                    wordClass += ' target';
                    displayWord = token;
                } else if (articles.includes(cleanJabber) || articles.includes(cleanReal)) {
                    // This is an article - show the real word
                    wordClass += ' article';
                    displayWord = realTokens[index];
                } else if (cleanJabber === cleanReal) {
                    // Word is the same in both - show real
                    wordClass += ' article';
                    displayWord = realTokens[index];
                } else {
                    // Regular word - can be clicked to reveal
                    wordClass += ' clickable';
                    displayWord = token;
                }
                
                html += `<span class="${wordClass}" data-index="${index}">${displayWord}</span>`;
            }
            
            html += `
                </div>
                <div class="controls">
                    <button class="guess-button" id="guess-btn">Make Guess</button>
                </div>
                </div>
            `;
            
            return html;
        },
        choices: ['Make Guess'],
        button_html: '<button class="jspsych-btn" style="display: none;">%choice%</button>',
        on_load: function() {
            const words = document.querySelectorAll('.word.clickable');
            words.forEach(word => {
                word.addEventListener('click', function() {
                    const index = parseInt(this.dataset.index);
                    if (!revealedWords.has(index)) {
                        revealedWords.add(index);
                        
                        // Deduct points
                        totalPoints -= POINTS_PER_REVEAL;
                        updatePointsDisplay(totalPoints);
                        
                        clickTimes.push({
                            word_index: index,
                            revealed_word: realTokens[index],
                            time_from_start: Date.now() - startTime
                        });
                        
                        this.textContent = realTokens[index];
                        this.classList.remove('clickable');
                        this.classList.add('revealed');
                    }
                });
            });
            
            document.getElementById('guess-btn').addEventListener('click', function() {
                // Filter out punctuation from revealed words
                const revealedWordsList = Array.from(revealedWords)
                    .filter(idx => !/^[.,!?;:'"]$/.test(realTokens[idx]))
                    .map(idx => realTokens[idx]);
                
                // Store word-reveal data in completedTrials array
                completedTrials[trialIndex] = {
                    trial_number: trialNumber,
                    subjCode: subjCode,
                    sublist: sublistNumber,
                    random_seed: randomSeed,
                    target_word: trial.target_word,
                    target_word_position: trial.target_word_position || targetIndex,
                    entropy: trial.entropy,
                    target_probability: trial.target_probability,
                    jabber_sentence: jabberSentence,
                    real_sentence: realSentence,
                    num_words_revealed: revealedWordsList.length,
                    revealed_words: JSON.stringify(revealedWordsList),
                    revealed_word_indices: JSON.stringify(Array.from(revealedWords)),
                    click_times: JSON.stringify(clickTimes),
                    total_time_before_guess: Date.now() - startTime,
                    points_remaining: totalPoints,
                    points_lost_this_trial: revealedWordsList.length * POINTS_PER_REVEAL
                };
                
                // End this trial and move to guess input
                jsPsych.finishTrial();
            });
        },
        trial_duration: null,
        response_ends_trial: false
    };
}

// Function to create guess input trial
function createGuessInputTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    return {
        type: jsPsychSurveyText,
        questions: [
            {
                prompt: `<div class="instructions">
                    <p>What do you think the <strong>bolded word</strong> was in the sentence?</p>
                    <p>Type your guess below:</p>
                </div>`,
                name: 'target_word_guess',
                required: true,
                rows: 1,
                columns: 40
            }
        ],
        on_finish: function(data) {
            const guess = data.response.target_word_guess.toLowerCase().trim().replace(/[.,!?]/g, '');
            const correct = trial.target_word.toLowerCase().trim().replace(/[.,!?]/g, '');
            
            // Add guess data to the stored trial object
            completedTrials[trialIndex].guess = data.response.target_word_guess;
            completedTrials[trialIndex].guess_correct = (guess === correct);
            completedTrials[trialIndex].rt_guess = data.rt;
        }
    };
}

// Function to create confidence rating trial
function createConfidenceRatingTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `
            <div style="text-align: center;">
                <p>How confident are you that you guessed the bolded word correctly?</p>
            </div>
        `,
        choices: ['1<br>Not at all confident', '2<br>Slightly confident', '3<br>Moderately confident', '4<br>Very confident', '5<br>Extremely confident'],
        button_html: '<button class="jspsych-btn" style="margin: 10px; padding: 15px 25px; font-size: 16px;">%choice%</button>',
        on_finish: function(data) {
            data.trial_type = 'confidence-rating';
            data.trial_number = trialNumber;
            data.original_trial_number = originalTrialNumber;
            data.randomization_position = trialIndex + 1;
            data.sublist = sublistNumber;
            data.random_seed = randomSeed;
            data.confidence_rating = data.response + 1; // Convert 0-4 to 1-5
            data.target_word = trial.target_word;
            data.points_remaining = totalPoints;
        }
    };
}

// Welcome screen
const welcome = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h1>Word Reveal Experiment</h1>
            <p>In this experiment, you will see sentences with made-up nonsense words.</p>
            <p>Your task is to:</p>
            <ul>
                <li>Click on words to reveal their true meaning</li>
                <li>Try to figure out what the <strong>bolded word</strong> means</li>
                <li>Make your best guess when you're ready</li>
            </ul>
            <p><strong>Scoring:</strong> You start with <strong>100 points</strong>. Each word you reveal costs <strong>${POINTS_PER_REVEAL} points</strong>. Try to keep as many points as possible!</p>
            <p>Note: The bolded word cannot be revealed - you must guess it based on context.</p>
            <p><em>Press any key to continue</em></p>
        </div>
    `
};

// Instructions
const instructions = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h2>Instructions</h2>
            <p>On each trial:</p>
            <ol>
                <li>You'll see a sentence with nonsense words</li>
                <li>One word will be <strong>bolded</strong> - this is your target word to guess</li>
                <li>Click on other words to reveal their true meaning (<strong>${POINTS_PER_REVEAL} points each</strong>)</li>
                <li>When you think you know the bolded word, click "Make Guess"</li>
                <li>Type your guess for the bolded word</li>
            </ol>
            <p><strong>Remember:</strong> You start with 100 points. Your goal is to keep as many points as possible!</p>
            <p><em>Press any key to start</em></p>
        </div>
    `
};

// Create timeline
async function createTimeline() {
    await loadTrialData();
    
    let timeline = [welcome, instructions];
    
    // Add trials for each sentence (now in randomized order)
    for (let i = 0; i < trialData.length; i++) {
        timeline.push(createWordRevealTrial(i));
        timeline.push(createGuessInputTrial(i));
        timeline.push(createConfidenceRatingTrial(i));
    }
    
    // Capture final score before data saving
    let finalScore = 0;
    
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '',
        trial_duration: 1,
        on_start: function() {
            finalScore = totalPoints;
            jsPsych.data.addProperties({
                experiment_version: '1.0',
                sublist: sublistNumber,
                random_seed: randomSeed,
                subjCode: subjCode,
                final_score: finalScore,
                completion_time: new Date().toISOString()
            });
        }
    });
    
    // Add data saving trial using jsPsychPipe
    const save_data = {
        type: jsPsychPipe,
        action: "save",
        experiment_id: "6sUXv8MJL3e6",
        filename: filename,
        data_string: () => jsPsych.data.get().csv()
    };
    
    timeline.push(save_data);
    
    // Thank you message with survey link and final score
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            // Get survey URL from URL parameter or use default
            const surveyURL = getURLParameter('survey_url') || 'https://uwmadison.co1.qualtrics.com/jfe/form/SV_0VC8tugavHYnhoa';
            // Add subjCode to survey URL
            const surveyWithId = `${surveyURL}${surveyURL.includes('?') ? '&' : '?'}subjCode=${subjCode}`;
            
            return `
                <div style="text-align: center;">
                    <h2>Thank you and great job!</h2>
                    <p>You have completed the experiment.</p>
                    <p><strong>Final Score: ${finalScore} points</strong></p>
                    <p>Your data has been saved.</p>
                    <p>Please click the link below to complete a brief survey:</p>
                    <p style="margin-top: 30px;">
                        <a href="${surveyWithId}" target="_blank" style="font-size: 18px; padding: 15px 30px; background-color: #2196f3; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Go to Survey
                        </a>
                    </p>
                    <p style="margin-top: 30px; font-size: 14px; color: #666;">
                        Press any key after completing the survey to close this window.
                    </p>
                </div>
            `;
        }
    });
    
    return timeline;
}

// Run the experiment
createTimeline().then(timeline => {
    jsPsych.run(timeline);
}).catch(error => {
    console.error('Error loading experiment:', error);
    document.body.innerHTML = `
        <div style="text-align: center; padding: 50px;">
            <h2>Error Loading Experiment</h2>
            <p>Could not load trial list for sublist ${sublistNumber}.</p>
            <p>Please make sure the file ${csvFilename} exists.</p>
            <p>Error: ${error.message}</p>
        </div>
    `;
});