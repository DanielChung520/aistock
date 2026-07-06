"""
OHLCV Data Update DAG - Daily at 3:00 PM

Downloads and maintains:
- Daily K-line: 10-year moving window from TWSE
- Minute K-line:
  - 1m, 5m: 7 days (yfinance)
  - 10m, 15m, 30m, 60m: 30 days (yfinance)

Schedule: Daily at 15:00 (Taiwan Time)
"""
from datetime import datetime, timedelta
import os
import sys

from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.bash import BashOperator
from airflow.models import Variable

default_args = {
    'owner': 'aistock',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

with DAG(
    dag_id='ohlcv_daily_update',
    default_args=default_args,
    description='Update OHLCV data - Daily K and Minute K',
    schedule_interval='0 15 * * *',  # Daily at 15:00
    start_date=datetime(2025, 1, 1),
    catchup=False,
    tags=['aistock', 'ohlcv', 'daily'],
) as dag:

    def update_schedule_status(**context):
        """Update schedule status in ArangoDB."""
        from arango import ArangoClient
        
        client = ArangoClient(hosts=os.getenv('ARANGO_URL', 'http://localhost:8530'))
        db = client.db(
            name=os.getenv('ARANGO_DB', 'aistock'),
            username=os.getenv('ARANGO_USER', 'root'),
            password=os.getenv('ARANGO_PASSWORD', 'aistock2024'),
        )
        
        now = datetime.now().isoformat()
        
        try:
            collection = db.collection('schedule_settings')
            collection.update(
                {
                    'lastRun': now,
                    'lastStatus': 'completed',
                    'lastRunDaily': now,
                    'lastStatusDaily': 'completed',
                    'lastRunMinute': now,
                    'lastStatusMinute': 'completed',
                },
                check_rev=False
            )
        except Exception as e:
            print(f'Failed to update status: {e}')

    def run_ohlcv_update(**context):
        """Run the OHLCV update script."""
        backend_path = '/opt/airflow/backend'
        script_path = f'{backend_path}/scripts/scheduled_ohlcv_update.py'
        
        import subprocess
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            cwd=backend_path,
        )
        
        if result.returncode != 0:
            print(f'Error: {result.stderr}')
            raise Exception(f'Script failed: {result.stderr}')
        
        print(f'Output: {result.stdout}')
        return result.stdout

    update_status_start = PythonOperator(
        task_id='update_status_start',
        python_callable=lambda **context: None,
        provide_context=True,
    )

    run_update = PythonOperator(
        task_id='run_ohlcv_update',
        python_callable=run_ohlcv_update,
        provide_context=True,
    )

    update_status_complete = PythonOperator(
        task_id='update_status_complete',
        python_callable=update_schedule_status,
        provide_context=True,
    )

    update_status_start >> run_update >> update_status_complete
