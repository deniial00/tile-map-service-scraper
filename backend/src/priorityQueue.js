export class PriorityQueue {
    constructor() {
        this.queue = [];
    }

    // Add a tile to the queue with priority
    enqueue(tile, priority) {
        this.queue.push({ tile, priority });
        this.queue.sort((a, b) => b.priority - a.priority); // Higher priority first
    }

    // Get the next tile from the queue
    dequeue() {
        return this.queue.shift();
    }

    // Check if queue is empty
    isEmpty() {
        return this.queue.length === 0;
    }

    // Get queue size
    size() {
        return this.queue.length;
    }

    // Clear the queue
    clear() {
        this.queue = [];
    }
} 