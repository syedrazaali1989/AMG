// TensorFlow.js ML Prediction Model
// LSTM-based time-series prediction for next candle direction

import * as tf from '@tensorflow/tfjs';
import { MLPrediction, Timeframe } from '../signals/types';

export interface TrainingData {
    prices: number[];
    volumes: number[];
    rsi: number;
    macd: number;
    outcome: number; // 1 for up, 0 for down
}

export class PredictiveModel {
    private static model: tf.LayersModel | null = null;
    private static modelVersion = 'v1.0.0';
    private static isTraining = false;
    private static modelAccuracy = 0;

    /**
    /**
     * Initialize or load the ML model
     */
    static async initialize(): Promise<void> {
        try {
            // Try to load existing model from browser storage
            const modelPath = 'indexeddb://trading-predictor-model';
            this.model = await tf.loadLayersModel(modelPath);
            console.log('✅ ML Model loaded from storage');

            // Load accuracy from localStorage
            const savedAccuracy = localStorage.getItem('mlModelAccuracy');
            if (savedAccuracy) {
                this.modelAccuracy = parseFloat(savedAccuracy);
            }
        } catch (error) {
            console.log('No existing model found, creating new model...');
            this.model = this.createModel();
            console.log('✅ New ML Model created');
        }
    }

    /**
     * Create LSTM model for time-series prediction
     */
    private static createModel(): tf.LayersModel {
        const model = tf.sequential();

        // Input layer: [lookback_period, features]
        // Features: price, volume, rsi, macd (4 features)
        const lookbackPeriod = 20;
        const features = 4;

        model.add(tf.layers.lstm({
            units: 50,
            returnSequences: true,
            inputShape: [lookbackPeriod, features]
        }));

        model.add(tf.layers.dropout({ rate: 0.2 }));

        model.add(tf.layers.lstm({
            units: 50,
            returnSequences: false
        }));

        model.add(tf.layers.dropout({ rate: 0.2 }));

        model.add(tf.layers.dense({
            units: 25,
            activation: 'relu'
        }));

        // Output: probability of UP movement (0-1)
        model.add(tf.layers.dense({
            units: 1,
            activation: 'sigmoid'
        }));

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
        });

        return model;
    }

    /**
     * Train model with historical data
     * @param trainingData Array of historical training samples
     */
    static async trainModel(trainingData: TrainingData[]): Promise<number> {
        if (this.isTraining) {
            console.warn('Model is already training');
            return this.modelAccuracy;
        }

        if (!this.model) {
            await this.initialize();
        }

        this.isTraining = true;

        try {
            // Prepare training data
            const { xs, ys } = this.prepareTrainingData(trainingData);

            // Train model
            const history = await this.model!.fit(xs, ys, {
                epochs: 50,
                batchSize: 32,
                validationSplit: 0.2,
                shuffle: true,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        if (epoch % 10 === 0) {
                            console.log(`Epoch ${epoch}: loss = ${logs?.loss.toFixed(4)}, acc = ${logs?.acc.toFixed(4)}`);
                        }
                    }
                }
            });

            // Save accuracy
            const finalAccuracy = history.history.acc[history.history.acc.length - 1] as number;
            this.modelAccuracy = finalAccuracy * 100;
            localStorage.setItem('mlModelAccuracy', this.modelAccuracy.toString());

            // Save model to browser storage
            await this.model!.save('indexeddb://trading-predictor-model');
            console.log(`✅ Model trained with ${finalAccuracy.toFixed(2)}% accuracy`);

            // Cleanup tensors
            xs.dispose();
            ys.dispose();

            this.isTraining = false;
            return this.modelAccuracy;
        } catch (error) {
            console.error('Training error:', error);
            this.isTraining = false;
            return 0;
        }
    }

    /**
     * Prepare training data for LSTM model
     */
    private static prepareTrainingData(trainingData: TrainingData[]): { xs: tf.Tensor, ys: tf.Tensor } {
        const lookbackPeriod = 20;
        const sequences: number[][][] = [];
        const labels: number[] = [];

        for (const sample of trainingData) {
            if (sample.prices.length < lookbackPeriod) continue;

            // Normalize data
            const normalizedPrices = this.normalize(sample.prices);
            const normalizedVolumes = this.normalize(sample.volumes);

            // Create sequence
            for (let i = lookbackPeriod; i < sample.prices.length; i++) {
                const sequence: number[][] = [];

                for (let j = i - lookbackPeriod; j < i; j++) {
                    sequence.push([
                        normalizedPrices[j],
                        normalizedVolumes[j],
                        sample.rsi / 100, // Normalize RSI to 0-1
                        (sample.macd + 100) / 200 // Normalize MACD to ~0-1
                    ]);
                }

                sequences.push(sequence);
                labels.push(sample.outcome);
            }
        }

        const xs = tf.tensor3d(sequences);
        const ys = tf.tensor2d(labels, [labels.length, 1]);

        return { xs, ys };
    }

    /**
     * Predict next candle direction
     * @param prices Recent price history
     * @param volumes Recent volume history
     * @param rsi Current RSI
     * @param macd Current MACD
     * @param currentPrice Current market price
     * @param timeframe Prediction timeframe
     * @returns ML Prediction
     */
    static async predict(
        prices: number[],
        volumes: number[],
        rsi: number,
        macd: number,
        currentPrice: number,
        timeframe: Timeframe = Timeframe.ONE_HOUR
    ): Promise<MLPrediction> {
        if (!this.model) {
            await this.initialize();
        }

        try {
            const lookbackPeriod = 20;

            if (prices.length < lookbackPeriod) {
                // Not enough data, return neutral prediction
                return this.getNeutralPrediction(currentPrice, timeframe);
            }

            // Prepare input data
            const recentPrices = prices.slice(-lookbackPeriod);
            const recentVolumes = volumes.slice(-lookbackPeriod);

            const normalizedPrices = this.normalize(recentPrices);
            const normalizedVolumes = this.normalize(recentVolumes);

            const sequence: number[][] = [];
            for (let i = 0; i < lookbackPeriod; i++) {
                sequence.push([
                    normalizedPrices[i],
                    normalizedVolumes[i],
                    rsi / 100,
                    (macd + 100) / 200
                ]);
            }

            // Make prediction
            const inputTensor = tf.tensor3d([sequence]);
            const prediction = this.model!.predict(inputTensor) as tf.Tensor;
            const predictionValue = await prediction.data();
            const probability = predictionValue[0]; // 0-1

            // Cleanup
            inputTensor.dispose();
            prediction.dispose();

            // Convert to confidence (0-100) and direction
            const confidence = Math.round(Math.abs(probability - 0.5) * 200); // 0-100
            const direction = probability > 0.5 ? 'UP' : (probability < 0.5 ? 'DOWN' : 'NEUTRAL');

            // Calculate average price range for targets
            const avgRange = this.calculateAverageRange(prices.slice(-30));

            let targetPrice: number;
            let expectedHigh: number;
            let expectedLow: number;

            if (direction === 'UP') {
                const move = avgRange * (confidence / 100) * 0.7;
                targetPrice = currentPrice + move;
                expectedHigh = currentPrice + avgRange;
                expectedLow = currentPrice - (avgRange * 0.3);
            } else if (direction === 'DOWN') {
                const move = avgRange * (confidence / 100) * 0.7;
                targetPrice = currentPrice - move;
                expectedHigh = currentPrice + (avgRange * 0.3);
                expectedLow = currentPrice - avgRange;
            } else {
                targetPrice = currentPrice;
                expectedHigh = currentPrice + (avgRange * 0.5);
                expectedLow = currentPrice - (avgRange * 0.5);
            }

            return {
                direction,
                confidence,
                targetPrice,
                expectedHigh,
                expectedLow,
                predictionHorizon: timeframe,
                modelVersion: this.modelVersion,
                modelAccuracy: this.modelAccuracy
            };
        } catch (error) {
            console.error('Prediction error:', error);
            return this.getNeutralPrediction(currentPrice, timeframe);
        }
    }

    /**
     * Normalize array to 0-1 range
     */
    private static normalize(data: number[]): number[] {
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min;

        if (range === 0) return data.map(() => 0.5);

        return data.map(val => (val - min) / range);
    }

    /**
     * Calculate average price range
     */
    private static calculateAverageRange(prices: number[]): number {
        if (prices.length < 2) return 0;

        const ranges: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            ranges.push(Math.abs(prices[i] - prices[i - 1]));
        }

        return ranges.reduce((a, b) => a + b, 0) / ranges.length;
    }

    /**
     * Return neutral prediction when model can't predict
     */
    private static getNeutralPrediction(currentPrice: number, timeframe: Timeframe): MLPrediction {
        return {
            direction: 'NEUTRAL',
            confidence: 0,
            targetPrice: currentPrice,
            expectedHigh: currentPrice * 1.01,
            expectedLow: currentPrice * 0.99,
            predictionHorizon: timeframe,
            modelVersion: this.modelVersion,
            modelAccuracy: this.modelAccuracy
        };
    }

    /**
     * Get model status
     */
    static getModelStatus(): { loaded: boolean; training: boolean; accuracy: number; version: string } {
        return {
            loaded: this.model !== null,
            training: this.isTraining,
            accuracy: this.modelAccuracy,
            version: this.modelVersion
        };
    }

    /**
     * Clear model from storage (for retraining)
     */
    static async clearModel(): Promise<void> {
        try {
            await tf.io.removeModel('indexeddb://trading-predictor-model');
            this.model = null;
            this.modelAccuracy = 0;
            localStorage.removeItem('mlModelAccuracy');
            console.log('✅ Model cleared from storage');
        } catch (error) {
            console.error('Error clearing model:', error);
        }
    }
}
