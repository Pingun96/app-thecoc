import urllib.request, json
try:
    req = urllib.request.Request('https://api.github.com/repos/Pingun96/app-thecoc/actions/runs', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        runs = json.loads(response.read())
        for i in range(min(5, len(runs['workflow_runs']))):
            run = runs['workflow_runs'][i]
            print(f"Run {i+1}: {run['name']} (ID: {run['id']})")
        run1_jobs = json.loads(urllib.request.urlopen(urllib.request.Request(runs['workflow_runs'][0]['jobs_url'])).read())
        run2_jobs = json.loads(urllib.request.urlopen(urllib.request.Request(runs['workflow_runs'][1]['jobs_url'])).read())
        
        for job in run1_jobs['jobs'] + run2_jobs['jobs']:
            if job['conclusion'] == 'failure':
                log_url = f"https://api.github.com/repos/Pingun96/app-thecoc/actions/jobs/{job['id']}/logs"
                print(f"Downloading log for {job['name']}...")
                try:
                    log_content = urllib.request.urlopen(urllib.request.Request(log_url)).read().decode('utf-8')
                    with open(f"{job['name'].replace(' ', '_')}.log", 'w', encoding='utf-8') as f:
                        f.write(log_content)
                except Exception as e:
                    print(f"Failed to download log: {e}")
except Exception as e:
    print(f"Error: {e}")

