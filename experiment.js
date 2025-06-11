// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let revealedWords = new Set();
let startTime = null;
let clickTimes = [];

// Articles that should not be obscured
const articles = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

// DataPipe configuration - REPLACE WITH YOUR ACTUAL VALUES
const DATAPIPE_ENDPOINT = 'https://osf.io/va8xm/';
const OSF_PROJECT_ID = '6sUXv8MJL3e6'; // Replace with your OSF project ID

// Initialize jsPsych
const jsPsych = initJsPsych({
    on_finish: function() {
        // Send data to DataPipe/OSF
        sendDataToOSF();
    }
});

// Function to load CSV data
function loadTrialData() {
    return new Promise((resolve, reject) => {
        // For demo purposes, using sample data that matches your CSV structure
        // Replace this with your actual CSV loading
        // const sampleData = [
        //     {
        //         trial_number: 1,  // or however you name this column
        //         ground_truth_sentence: "the cat jumped a fence in the yard",
        //         nonsense_sentence: "the blork snerfed a gribble in the flump", 
        //         target_word_index: 6, // 0-indexed position of target word
        //         target_word: "yard"   // the actual target word string
        //     },
        //     {
        //         trial_number: 2,
        //         ground_truth_sentence: "a student opened the book with pages",
        //         nonsense_sentence: "a wibble flonked the zorb with blargs",
        //         target_word_index: 5,
        //         target_word: "pages"
        //     }
        // ];
        
        // trialData = sampleData;
        // resolve();
        
        // TO USE YOUR CSV FILE: 
        // 1. Replace 'trials.csv' with your actual CSV file path
        // 2. Make sure your CSV headers match the expected column names
        // 3. Uncomment the code below and comment out the sampleData above
        
        Papa.parse('trial_list_test.csv', {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true, // Automatically convert numbers
            complete: function(results) {
                console.log('Loaded CSV data:', results.data);
                
                // Validate the data structure
                if (results.data.length === 0) {
                    reject(new Error('CSV file is empty'));
                    return;
                }
                
                // Check for required columns
                const requiredColumns = ['ground_truth_sentence', 'nonsense_sentence', 'target_word_index', 'target_word'];
                const firstRow = results.data[0];
                const missingColumns = requiredColumns.filter(col => !(col in firstRow));
                
                if (missingColumns.length > 0) {
                    reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
                    return;
                }
                
                trialData = results.data;
                console.log(`Successfully loaded ${trialData.length} trials`);
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
    // Use whatever column names your CSV has - adjust these as needed:
    const nonsenseWords = trial.nonsense_sentence.split(' ');
    const realWords = (trial.ground_truth_sentence || trial.real_sentence).split(' ');
    const targetIndex = parseInt(trial.target_word_index);
    const trialNumber = trial.trial_number || trial.sentence_id || (trialIndex + 1);
    
    // Validation: Check that target_word_index makes sense
    if (targetIndex < 0 || targetIndex >= nonsenseWords.length) {
        console.error(`Invalid target_word_index ${targetIndex} for trial ${trialNumber}`);
    }
    
    // Validation: Check that the target word matches
    const expectedTargetWord = realWords[targetIndex];
    if (expectedTargetWord && expectedTargetWord.toLowerCase().replace(/[.,!?]/g, '') !== 
        trial.target_word.toLowerCase().replace(/[.,!?]/g, '')) {
        console.warn(`Target word mismatch in trial ${trialNumber}: expected "${expectedTargetWord}", got "${trial.target_word}"`);
    }
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function() {
            currentTrial = trial;
            revealedWords.clear();
            startTime = Date.now();
            clickTimes = [];
            
            let html = `
                <div class="trial-counter">Trial ${trialNumber} of ${trialData.length}</div>
                <div class="instructions">
                    <p>Click on words to reveal their true meaning. The <strong>bolded word</strong> cannot be revealed - try to guess what it is based on the other words you reveal.</p>
                    <p>When you're ready to guess the bolded word, click "Make Guess".</p>
                </div>
                <div class="sentence-container" id="sentence-container">
            `;
            
            nonsenseWords.forEach((word, index) => {
                let wordClass = 'word';
                let wordText = word;
                
                if (index === targetIndex) {
                    // This is the target word - make it bold and non-clickable
                    wordClass += ' target';
                } else if (articles.includes(word.toLowerCase().replace(/[.,!?]/g, ''))) {
                    // This is an article - show the real word and make it non-clickable
                    wordClass += ' article';
                    wordText = realWords[index];
                } else {
                    // This is a regular word that can be clicked to reveal
                    wordClass += ' clickable';
                }
                
                html += `<span class="${wordClass}" data-index="${index}">${wordText}</span>`;
            });
            
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
            // Add click listeners to clickable words only
            const words = document.querySelectorAll('.word.clickable');
            words.forEach(word => {
                word.addEventListener('click', function() {
                    const index = parseInt(this.dataset.index);
                    if (!revealedWords.has(index)) {
                        revealedWords.add(index);
                        clickTimes.push({
                            word_index: index,
                            revealed_word: realWords[index],
                            time_from_start: Date.now() - startTime
                        });
                        
                        // Reveal the word
                        this.textContent = realWords[index];
                        this.classList.remove('clickable');
                        this.classList.add('revealed');
                    }
                });
            });
            
            // Add click listener to guess button
            document.getElementById('guess-btn').addEventListener('click', function() {
                jsPsych.finishTrial({
                    trial_number: trialNumber,
                    sentence_id: trial.sentence_id || trialNumber,
                    target_word_index: targetIndex,
                    target_word: trial.target_word,
                    revealed_words: Array.from(revealedWords),
                    click_times: clickTimes,
                    total_time_before_guess: Date.now() - startTime,
                    num_words_revealed: revealedWords.size,
                    nonsense_sentence: trial.nonsense_sentence,
                    ground_truth_sentence: realWords.join(' ')
                });
            });
        },
        trial_duration: null,
        response_ends_trial: false
    };
}

// Function to create guess input trial
function createGuessInputTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trial.trial_number || trial.sentence_id || (trialIndex + 1);
    
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
            // Store comprehensive trial information
            data.trial_number = trialNumber;
            data.sentence_id = trial.sentence_id || trialNumber;
            data.correct_target_word = trial.target_word;
            data.target_word_index = trial.target_word_index;
            data.nonsense_sentence = trial.nonsense_sentence;
            data.ground_truth_sentence = trial.ground_truth_sentence || trial.real_sentence;
            
            // Check if guess is correct (case-insensitive, remove punctuation)
            const guess = data.response.target_word_guess.toLowerCase().trim().replace(/[.,!?]/g, '');
            const correct = trial.target_word.toLowerCase().trim().replace(/[.,!?]/g, '');
            data.guess_correct = guess === correct;
            
            // Store additional useful info
            data.guess_length = data.response.target_word_guess.length;
            data.target_word_length = trial.target_word.length;
        }
    };
}

// Function to send data to OSF via DataPipe
function sendDataToOSF() {
    const data = jsPsych.data.get().json();
    
    fetch(DATAPIPE_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            experimentID: OSF_PROJECT_ID,
            filename: `word_reveal_${Date.now()}.json`,
            data: data
        })
    }).then(response => {
        if (response.ok) {
            console.log('Data sent successfully to OSF');
        } else {
            console.error('Failed to send data to OSF');
        }
    }).catch(error => {
        console.error('Error sending data to OSF:', error);
    });
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
                <li>Click on other words to reveal their true meaning</li>
                <li>When you think you know the bolded word, click "Make Guess"</li>
                <li>Type your guess for the bolded word</li>
            </ol>
            <p>Strategy tip: Reveal words that might give you context clues about the bolded word!</p>
            <p><em>Press any key to start</em></p>
        </div>
    `
};

// Create timeline
async function createTimeline() {
    await loadTrialData();
    
    let timeline = [welcome, instructions];
    
    // Add trials for each sentence
    for (let i = 0; i < trialData.length; i++) {
        timeline.push(createWordRevealTrial(i));
        timeline.push(createGuessInputTrial(i));
    }
    
    // Thank you message
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `
            <div style="text-align: center;">
                <h2>Thank you!</h2>
                <p>You have completed the experiment.</p>
                <p>Your data has been saved.</p>
                <p>Press any key to finish.</p>
            </div>
        `,
        on_finish: function() {
            // Final data processing
            jsPsych.data.addProperties({
                experiment_version: '1.0',
                completion_time: new Date().toISOString()
            });
        }
    });
    
    return timeline;
}

// Run the experiment
createTimeline().then(timeline => {
    jsPsych.run(timeline);
}).catch(error => {
    console.error('Error loading experiment:', error);
    document.body.innerHTML = '<p>Error loading experiment. Please refresh the page.</p>';
});