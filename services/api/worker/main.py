import argparse
import sys
import time
from worker.preparation import process_single_preparation_task

def main():
    parser = argparse.ArgumentParser(description="AutoPrint v3 Leased Background Worker")
    parser.add_argument("--once", action="store_true", help="Process one task and exit")
    args = parser.parse_args()

    print("[WORKER] Starting AutoPrint v3 PDF preparation worker...")

    if args.once:
        processed = process_single_preparation_task("worker-oneshot")
        if processed:
            print("[WORKER] Successfully processed one preparation task.")
        else:
            print("[WORKER] No pending preparation task found.")
        sys.exit(0)

    print("[WORKER] Running continuous loop (Press Ctrl+C to stop)...")
    try:
        while True:
            processed = process_single_preparation_task("worker-daemon")
            if not processed:
                time.sleep(2)
    except KeyboardInterrupt:
        print("[WORKER] Worker stopped by operator.")

if __name__ == "__main__":
    main()
