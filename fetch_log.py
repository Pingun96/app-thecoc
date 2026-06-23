import json, urllib.request

req = urllib.request.Request('https://api.github.com/repos/Pingun96/app-thecoc/actions/runs')
with urllib.request.urlopen(req) as response:
    runs = json.loads(response.read())
latest_run = runs['workflow_runs'][0]
print(f"Latest run ID: {latest_run['id']}")
jobs_url = latest_run['jobs_url']

req = urllib.request.Request(jobs_url)
with urllib.request.urlopen(req) as response:
    jobs = json.loads(response.read())

for job in jobs['jobs']:
    if job['conclusion'] == 'failure':
        print(f"Failed job: {job['name']}")
        log_url = f"https://api.github.com/repos/Pingun96/app-thecoc/actions/jobs/{job['id']}/logs"
        print(f"Log URL: {log_url}")
        try:
            req = urllib.request.Request(log_url)
            with urllib.request.urlopen(req) as response:
                log_content = response.read().decode('utf-8')
                with open('failed_log.txt', 'w', encoding='utf-8') as f:
                    f.write(log_content)
                print('Log saved to failed_log.txt')
        except Exception as e:
            print(f'Could not fetch log directly: {e}')
