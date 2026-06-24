import urllib.request, json
try:
    req = urllib.request.Request('https://api.github.com/repos/Pingun96/app-thecoc/actions/runs', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        runs = json.loads(response.read())
        for i in range(min(5, len(runs['workflow_runs']))):
            run = runs['workflow_runs'][i]
            print(f"Run {i+1}: {run['name']} (ID: {run['id']})")
            print(f"  Status: {run['status']}, Conclusion: {run['conclusion']}")
            print(f"  Created at: {run['created_at']}")
except Exception as e:
    print(f'Error: {e}')
