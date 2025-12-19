// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let revealedWords = new Set();
let startTime = null;
let clickTimes = [];
let randomSeed = null;
let trialPoints = 100; // Points per trial (resets each trial)
let pointsPerReveal = 0; // Calculated based on revealable words in current trial
let numRevealableWords = 0; // Number of words that can be revealed in current trial
let completedTrials = []; // Store completed trial data
let sublistNumber = 1; // Will be set by condition assignment
let totalScore = 0;

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

// Initialize jsPsych
const jsPsych = initJsPsych({});

// Initialize filename based on subjCode
const subjCode = getURLParameter('subjCode');
const filename = `${subjCode}.csv`;

// Function to update points display
function updatePointsDisplay(points) {
    const pointsElement = document.getElementById('points-counter');
    if (pointsElement) {
        pointsElement.textContent = `Trial Points: ${Math.round(points)}`;
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
    const regex = /(\s+|[.,!?;:'"()])/g;
    const parts = sentence.split(regex);
    
    for (let part of parts) {
        if (part && part.trim() !== '') {
            tokens.push(part);
        }
    }
    
    return tokens;
}

// Function to parse word_to_nonce mapping
function parseWordToNonce(trial) {
    let mapping = {};
    
    if (trial.word_to_nonce) {
        try {
            // Handle both JSON string and object
            if (typeof trial.word_to_nonce === 'string') {
                mapping = JSON.parse(trial.word_to_nonce);
            } else {
                mapping = trial.word_to_nonce;
            }
        } catch (e) {
            console.warn('Could not parse word_to_nonce:', e);
        }
    }
    
    return mapping;
}

// Function to find target word index in sentence
function findTargetWordIndex(words, targetWord, targetPos) {
    // If targetPos is a number, use it directly
    if (typeof targetPos === 'number' && targetPos >= 0 && targetPos < words.length) {
        return targetPos;
    }
    
    // Otherwise, search for the target word
    for (let i = 0; i < words.length; i++) {
        const cleanWord = words[i].toLowerCase().replace(/[.,!?;:'"]/g, '');
        const cleanTarget = targetWord.toLowerCase().replace(/[.,!?;:'"]/g, '');
        if (cleanWord === cleanTarget) {
            return i;
        }
    }
    
    console.error(`Could not find target word '${targetWord}' in sentence`);
    return -1;
}

// Function to load and randomize CSV data
function loadTrialData(sublistNum) {
    const csvFilename = `trial_list_sublist_${sublistNum}.csv`;
    
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
                
                console.log(`Successfully loaded ${trialData.length} trials from sublist ${sublistNum}`);
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

// Function to count revealable words in a trial
function countRevealableWords(realWords, jabberWords, targetIndex) {
    let count = 0;
    
    for (let i = 0; i < jabberWords.length; i++) {
        if (i === targetIndex) continue;
        
        const cleanJabber = jabberWords[i].toLowerCase().replace(/[.,!?;:'"]/g, '');
        const cleanReal = i < realWords.length ? realWords[i].toLowerCase().replace(/[.,!?;:'"]/g, '') : '';
        
        // Skip if it's an article or if the words are the same
        if (articles.includes(cleanJabber) || articles.includes(cleanReal) || cleanJabber === cleanReal) {
            continue;
        }
        
        count++;
    }
    
    return count;
}

// Function to create word reveal trial
function createWordRevealTrial(trialIndex) {
    const trial = trialData[trialIndex];
    
    // Parse the passages
    const realSentence = trial.passage_variant || trial.ground_truth_sentence || '';
    const jabberSentence = trial.jabber_passage || trial.nonsense_sentence || '';
    
    const realWords = realSentence.split(' ');
    const jabberWords = jabberSentence.split(' ');
    
    // Get target word and find its position
    const targetWord = trial.target_word;
    const targetPos = trial.target_pos || trial.target_word_index;
    const targetIndex = findTargetWordIndex(realWords, targetWord, targetPos);
    
    const trialNumber = trialIndex + 1; // Use position in randomized order
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    // Calculate revealable words and points per reveal
    numRevealableWords = countRevealableWords(realWords, jabberWords, targetIndex);
    pointsPerReveal = numRevealableWords > 0 ? trialPoints / numRevealableWords : 0;
    
    console.log(`Trial ${trialNumber}: ${numRevealableWords} revealable words, ${pointsPerReveal.toFixed(2)} points per reveal`);
    
    // Get word-to-nonce mapping
    const wordToNonce = parseWordToNonce(trial);
    
    // Debug logging
    console.log(`Trial ${trialNumber}:`, {
        targetWord,
        targetPos,
        targetIndex,
        realWordsCount: realWords.length,
        jabberWordsCount: jabberWords.length,
        targetInReal: realWords[targetIndex],
        targetInJabber: jabberWords[targetIndex],
        numRevealableWords,
        pointsPerReveal
    });
    
    // Validation
    if (targetIndex < 0 || targetIndex >= realWords.length) {
        console.error(`Invalid target index ${targetIndex} for trial ${originalTrialNumber}`);
    }
    
    // Verify word counts match
    if (realWords.length !== jabberWords.length) {
        console.warn(`Word count mismatch: real=${realWords.length}, jabber=${jabberWords.length}`);
    }
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function() {
            currentTrial = trial;
            revealedWords.clear();
            startTime = Date.now();
            clickTimes = [];
            trialPoints = 100; // Reset points at start of trial
            
            let html = `
                <div class="trial-counter">Trial ${trialNumber} of ${trialData.length}</div>
                <div class="instructions">
                    <p>Click on words to reveal their true meaning. The <strong>bolded word</strong> cannot be revealed - try to guess what it is based on the other words you reveal.</p>
                    <p>When you're ready to guess the bolded word, click "Make Guess".</p>
                    <p style="font-size: 14px; color: #666; margin-top: 10px;"><em>Note: Each word you reveal reduces your points for this trial</em></p>
                </div>
                <div class="points-counter" id="points-counter">Trial Points: 100</div>
                <div class="sentence-container" id="sentence-container">
            `;
            
            // Build sentence word by word
            for (let index = 0; index < jabberWords.length; index++) {
                let wordClass = 'word';
                let displayWord = jabberWords[index];
                
                // Clean word for comparison (remove punctuation)
                const cleanJabber = jabberWords[index].toLowerCase().replace(/[.,!?;:'"]/g, '');
                const cleanReal = index < realWords.length ? realWords[index].toLowerCase().replace(/[.,!?;:'"]/g, '') : '';
                
                if (index === targetIndex) {
                    // This is the target word - keep it as jabberwocky and make it bold
                    wordClass += ' target';
                    displayWord = jabberWords[index];
                } else if (articles.includes(cleanJabber) || articles.includes(cleanReal)) {
                    // This is an article - show the real word
                    wordClass += ' article';
                    displayWord = realWords[index];
                } else if (cleanJabber === cleanReal) {
                    // Word is the same in both (likely punctuation or article) - show real
                    wordClass += ' article';
                    displayWord = realWords[index];
                } else {
                    // Regular word - can be clicked to reveal
                    wordClass += ' clickable';
                    displayWord = jabberWords[index];
                }
                
                html += `<span class="${wordClass}" data-index="${index}">${displayWord}</span>`;
            }
            
            html += `
                </div>
                <div class="controls">
                    <button class="guess-button" id="guess-btn">Make Guess</button>
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
                        
                        // Deduct points proportionally
                        trialPoints -= pointsPerReveal;
                        updatePointsDisplay(trialPoints);
                        
                        clickTimes.push({
                            word_index: index,
                            revealed_word: realWords[index],
                            time_from_start: Date.now() - startTime,
                            points_remaining: trialPoints
                        });
                        
                        this.textContent = realWords[index];
                        this.classList.remove('clickable');
                        this.classList.add('revealed');
                    }
                });
            });
            
            document.getElementById('guess-btn').addEventListener('click', function() {
                // Store trial data before finishing
                const trialDataToStore = {
                    trial_type: 'word-reveal',
                    trial_number: trialNumber,
                    original_trial_number: originalTrialNumber,
                    randomization_position: trialIndex + 1,
                    sublist: sublistNumber,
                    random_seed: randomSeed,
                    target_word_index: targetIndex,
                    target_word: trial.target_word,
                    entropy: trial.entropy,
                    target_probability: trial.target_probability,
                    revealed_words: Array.from(revealedWords).map(idx => realWords[idx]),
                    revealed_word_indices: Array.from(revealedWords),
                    click_times: clickTimes,
                    total_time_before_guess: Date.now() - startTime,
                    num_words_revealed: revealedWords.size,
                    num_revealable_words: numRevealableWords,
                    points_per_reveal: pointsPerReveal,
                    points_remaining: Math.max(0, trialPoints),
                    jabber_sentence: jabberSentence,
                    real_sentence: realSentence,
                    subjCode: subjCode
                };
                
                // Store this in completedTrials array
                completedTrials[trialIndex] = trialDataToStore;
                
                jsPsych.finishTrial({});
            });
        },
        trial_duration: null,
        response_ends_trial: false
    };
}

// Function to create guess input trial with paste blocking and single-word validation
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
                    <p>Type your guess below (single word only, no pasting):</p>
                </div>`,
                name: 'target_word_guess',
                required: true,
                rows: 1,
                columns: 40
            }
        ],
        on_load: function() {
            // Get the input element
            const inputElement = document.querySelector('input[name="target_word_guess"]');
            
            if (inputElement) {
                // Disable paste
                inputElement.addEventListener('paste', function(e) {
                    e.preventDefault();
                    alert('Pasting is not allowed. Please type your answer.');
                });
                
                // Add visual indicator that paste is disabled
                inputElement.setAttribute('title', 'Pasting is disabled - please type your answer');
            }
        },
        on_finish: function(data) {
            const rawGuess = data.response.target_word_guess;
            const guess = rawGuess.toLowerCase().trim().replace(/[.,!?]/g, '');
            const correct = trial.target_word.toLowerCase().trim().replace(/[.,!?]/g, '');
            const isCorrect = guess === correct;
            
            // Check if guess contains multiple words (contains whitespace)
            const hasMultipleWords = /\s/.test(rawGuess.trim());
            
            // Add guess data to completedTrials
            if (completedTrials[trialIndex]) {
                completedTrials[trialIndex].guess = rawGuess;
                completedTrials[trialIndex].guess_cleaned = guess;
                completedTrials[trialIndex].guess_correct = isCorrect;
                completedTrials[trialIndex].guess_has_multiple_words = hasMultipleWords;
                completedTrials[trialIndex].rt_guess = data.rt;
            }
            
            // If multiple words detected, show warning (but still continue)
            if (hasMultipleWords) {
                console.warn(`Participant entered multiple words: "${rawGuess}"`);
            }
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
            // Add confidence data to the stored trial object
            completedTrials[trialIndex].confidence_rating = data.response + 1; // Convert 0-4 to 1-5
            completedTrials[trialIndex].rt_confidence = data.rt;
            
            // REPLACE all data properties with our completedTrials data
            // First, get the keys from our completed trial
            const trialData = completedTrials[trialIndex];
            
            // Clear existing data properties (except internal jsPsych ones)
            const internalKeys = ['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'];
            for (let key in data) {
                if (!internalKeys.includes(key)) {
                    delete data[key];
                }
            }
            
            // Now add our custom data
            for (let key in trialData) {
                data[key] = trialData[key];
            }
        }
    };
}

// Function to create feedback trial showing the correct answer
function createFeedbackTrial(trialIndex) {
    const trial = trialData[trialIndex];
    
    return {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            const targetWord = trial.target_word;
            return `
                <div style="text-align: center; max-width: 600px; margin: 0 auto; padding: 40px;">
                    <h2>Great job!</h2>
                    <p style="font-size: 18px; margin: 30px 0;">The target word was:</p>
                    <p style="font-size: 36px; font-weight: bold; margin: 30px 0;">${targetWord}</p>
                    <p style="margin-top: 40px; font-size: 14px; color: #666;"><em>Press any key to continue</em></p>
                </div>
            `;
        },
        trial_duration: 3000, // Auto-advance after 3 seconds
        response_ends_trial: true
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
            <p><strong>Important:</strong> You'll earn points for each trial. Revealing fewer words gives you more points!</p>
            <p><strong>If you cannot narrow down your guess to ONE WORD, you need to reveal more words. </strong></p>
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
                <li>Click on other words to reveal their true meaning (but this costs points!)</li>
                <li>When you think you know the bolded word, click "Make Guess"</li>
                <li>Type your guess for the bolded word (single word only)</li>
                <li>Rate your confidence</li>
            </ol>
            <p><strong>Scoring:</strong> You start with 100 points per trial. Each word you reveal reduces your points proportionally. Try to use as few reveals as possible!</p>
            <p><em>Press any key to start</em></p>
        </div>
    `
};

// Create timeline
async function createTimeline(sublistNum) {
    await loadTrialData(sublistNum);
    
    let timeline = [welcome, instructions];
    
    // Add trials for each sentence (now in randomized order)
    for (let i = 0; i < trialData.length; i++) {
        timeline.push(createWordRevealTrial(i));
        timeline.push(createGuessInputTrial(i));
        timeline.push(createConfidenceRatingTrial(i));
        timeline.push(createFeedbackTrial(i));
    }
    
    // Calculate and store total score
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '',
        trial_duration: 1,
        on_start: function() {
            // Calculate total score from all trials
            totalScore = completedTrials.reduce((sum, trial) => {
                return sum + (trial ? Math.round(trial.points_remaining) : 0);
            }, 0);
            
            jsPsych.data.addProperties({
                experiment_version: '2.0_proportional_datapipe',
                sublist: sublistNumber,
                random_seed: randomSeed,
                subjCode: subjCode,
                total_score: totalScore,
                completion_time: new Date().toISOString()
            });
        }
    });
    
    // Write completedTrials to jsPsych data store with total_score
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '',
        trial_duration: 1,
        on_start: function() {
            // Add total score to each completed trial
            completedTrials.forEach(trial => {
                if (trial) {
                    trial.total_score = totalScore;
                    trial.completion_time = new Date().toISOString();
                }
            });
            console.log('Added total_score to completedTrials:', totalScore);
        }
    });
    
    // Add data saving trial using jsPsychPipe
    const save_data = {
        type: jsPsychPipe,
        action: "save",
        experiment_id: "6sUXv8MJL3e6",
        filename: filename,
        data_string: () => {
            // Use jsPsych's built-in CSV generation but only for confidence trials
            // which now have all the combined data
            const allData = jsPsych.data.get();
            const confidenceData = allData.filter({trial_type: 'html-button-response'});
            
            console.log('Filtering to confidence trials');
            console.log('Total trials:', allData.count());
            console.log('Confidence trials:', confidenceData.count());
            
            // Log the first confidence trial to see what columns it has
            if (confidenceData.count() > 0) {
                const firstTrial = confidenceData.values()[0];
                console.log('First confidence trial columns:', Object.keys(firstTrial));
                console.log('First confidence trial data:', firstTrial);
            }
            
            const csvString = confidenceData.csv();
            console.log('CSV first 1000 chars:', csvString.substring(0, 1000));
            
            return csvString;
        },
        on_finish: function(data) {
            console.log('Save trial finished');
            console.log('Save trial data:', data);
            if (data.success === false) {
                console.error('Upload failed!', data);
            } else {
                console.log('Upload successful!');
            }
        }
    };
    
    timeline.push(save_data);
    
    // Thank you message with survey link and total score
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            // Get survey URL from URL parameter or use default
            const surveyURL = getURLParameter('survey_url') || 'https://uwmadison.co1.qualtrics.com/jfe/form/SV_0VC8tugavHYnhoa';
            // Add subjCode to survey URL
            const surveyWithId = `${surveyURL}${surveyURL.includes('?') ? '&' : '?'}subjCode=${subjCode}`;
            
            const maxPossibleScore = trialData.length * 100;
            const scorePercentage = Math.round((totalScore / maxPossibleScore) * 100);
            
            return `
                <div style="text-align: center;">
                    <h2>Thank you and great job!</h2>
                    <p><strong>Total Score: ${totalScore} / ${maxPossibleScore} points (${scorePercentage}%)</strong></p>
                    <p>Your data has been saved.</p>
                    <p>Click the link below to complete a brief survey. <strong>You will recieve your HIIT for this experiment AFTER COMPLETING THE SURVEY</strong></p>
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

// Main experiment function with datapipe condition assignment
async function createExperiment() {
    try {
        console.log('Getting condition from datapipe...');
        const condition = await jsPsychPipe.getCondition("6sUXv8MJL3e6");
        console.log('Received condition:', condition);
        
        // Map condition (0-3) to sublist (1-4)
        sublistNumber = condition + 1;
        
        console.log(`Condition ${condition} -> Sublist ${sublistNumber}`);
        console.log(`Using random seed: ${randomSeed}`);
        
        // Create timeline with the assigned sublist
        const timeline = await createTimeline(sublistNumber);
        
        // Run the experiment
        jsPsych.run(timeline);
        
    } catch (error) {
        console.error('Error in createExperiment:', error);
        document.body.innerHTML = `
            <div style="text-align: center; padding: 50px;">
                <h2>Error Loading Experiment</h2>
                <p>Could not initialize experiment.</p>
                <p>Error: ${error.message}</p>
                <p>Please contact the researcher if this problem persists.</p>
            </div>
        `;
    }
}

// Start the experiment
createExperiment();
