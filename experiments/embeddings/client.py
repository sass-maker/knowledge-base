"""Use the deployed trial through your existing authenticated Modal SDK profile."""

import argparse
import json
import time

import modal


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["gemma", "small"], default="gemma")
    parser.add_argument("--input", default="How do I authenticate an HTTP request?")
    parser.add_argument("--task", default="retrieval_query")
    parser.add_argument("--dimensions", type=int)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    name = "EmbeddingGemma2" if args.model == "gemma" else "BgeSmall"
    deployed = modal.Cls.from_name("embedding-model-trial", name)()
    started = time.perf_counter()
    if args.verify:
        result = deployed.verify.remote()
    else:
        payload = {"input": args.input, "task": args.task}
        if args.dimensions is not None:
            payload["dimensions"] = args.dimensions
        result = deployed.embed.remote(payload)
    print(
        json.dumps(
            {
                "round_trip_ms": round((time.perf_counter() - started) * 1000, 2),
                "result": result,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
