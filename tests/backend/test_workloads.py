import json
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
import httpx
import pytest

from backend.collectors import ci_environment, source
from backend.config import Settings
from backend.main import create_app
from backend.store import Store
from backend.workloads import Workloads, scope_values

TOKEN = "workload-test-token-at-least-32-characters"


def sources():
    return {"docker": source({"images":[{"id":"sha256:image-a","tags":["toolchain:a"],"size_bytes":100,"created":1}],"containers":[]}),"gitlab":source({},"not_configured"),"host":source({"cpu":{"percent":20},"memory":{"percent":10,"available":1000}}),"runner":source({"metrics":{"gitlab_runner_concurrent":16}})}


def worker(identifier, project, pipeline, image="sha256:image-a", job="1", state="running"):
    return {"id":identifier,"name":"worker-"+identifier,"image":image,"image_id":image,"ci":True,"state":state,"status":state,"ci_metadata":{"project_id":project,"project_path":"team/project-"+project,"pipeline_id":pipeline,"job_id":job}}


def test_ci_metadata_retains_only_public_allowlisted_identifiers():
    environment = {"CI_PROJECT_ID":"3", "CI_PIPELINE_ID":"12", "CI_JOB_ID":"99", "CI_JOB_NAME":"build", "CI_PROJECT_PATH":"team/project", "CI_JOB_TOKEN":"secret", "PRIVATE_KEY":"secret", "CI_REGISTRY_PASSWORD":"secret", "CI_RUNNER_ID":"not-numeric"}
    value=ci_environment([f"{key}={value}" for key,value in environment.items()])
    assert value == {"project_id":"3","pipeline_id":"12","job_id":"99","job_name":"build","project_path":"team/project"}
    assert "secret" not in json.dumps(value)


def test_project_pipeline_image_attribution_unknown_outcomes_and_pagination(tmp_path):
    store=Store(str(tmp_path/"db.sqlite"));state=sources()
    rows=[worker(str(i),"3" if i<22 else "4","10" if i<22 else "20",job=str(i)) for i in range(25)]
    state["docker"]["data"]["containers"]=rows
    store.observe_workers(rows,30)
    service=Workloads(store,state)
    view=service.view(scope_values(project="3"),kind="workers")
    assert view["total"]==22 and len(view["rows"])==20
    assert view["summary"]["unknown_outcomes"]==1 and view["summary"]["successful_pipelines"]==0
    assert view["summary"]["running_containers"]==22
    assert service.view(scope_values(project="3"),kind="workers",page=2)["rows"][0]["id"] in {row["id"] for row in rows[:22]}
    image=service.view(scope_values(project="3"),kind="images")["rows"][0]
    assert image["projects"]==["3"] and image["global_projects"]==["3","4"]
    assert image["observed_containers"] == 22
    assert service.view(scope_values(project="4",pipeline="3:10"))["total"]==0
    assert service.view(scope_values(image="unknown"),kind="images")["total"]==0
    assert store.observed_project_ids()==["3","4"]


def test_gitlab_outcomes_are_retained_and_not_replaced_by_container_exit(tmp_path):
    store=Store(str(tmp_path/"db.sqlite"));state=sources();rows=[worker("one","3","10",state="exited")]
    store.observe_workers(rows,30)
    store.observe_gitlab({"pipelines":[{"id":10,"project_id":3,"project":"team/project-3","status":"success","duration":120,"queued_duration":20}],"jobs":[]},30)
    service=Workloads(store,state)
    row=service.view(scope_values())["rows"][0]
    assert row["status"]=="success" and row["source"]=="gitlab" and row["duration"]==120
    store.observe_gitlab({"pipelines":[{"id":10,"project_id":3,"project":"team/project-3","status":"success","duration":None}],"jobs":[]},30)
    assert store.pipeline_records()[0]["duration"]==120
    assert service.view(scope_values())["summary"]["median_success_duration"]==120
    assert service.view(scope_values())["summary"]["successful_pipelines"]==1


def test_job_mapping_attributes_pipeline_when_local_pipeline_id_is_missing(tmp_path):
    store=Store(str(tmp_path/"db.sqlite"));state=sources();row=worker("one","3","10",job="99")
    del row["ci_metadata"]["pipeline_id"]
    store.observe_workers([row],30)
    store.observe_gitlab({"jobs":[{"id":99,"project_id":3,"project":"team/project-3","pipeline":10,"name":"compile","status":"success"}],"pipelines":[]},30)
    view=Workloads(store,state).view(scope_values(pipeline="3:10"))
    assert view["total"]==1 and view["summary"]["observed_jobs"]==1
    assert view["worker_metadata"]["one"]["pipeline_id"]==10


def test_checkpoints_are_immutable_scoped_and_do_not_include_credentials(tmp_path):
    store=Store(str(tmp_path/"db.sqlite"));state=sources();service=Workloads(store,state)
    first=service.capture("Before","initial",scope_values())
    state["host"]["data"]["cpu"]["percent"]=50
    state["gitlab"]["data"]["token"]="not-part-of-checkpoint"
    second=service.capture("After","changed",scope_values())
    assert service.compare(first["id"],second["id"])["before"]["resources"]["cpu_percent"]==20
    assert store.checkpoint(second["id"])["resources"]["cpu_percent"]==50
    assert "not-part-of-checkpoint" not in json.dumps(store.checkpoint(second["id"]))
    other=service.capture("Other","",scope_values(project="3"))
    with pytest.raises(Exception) as exc:service.compare(first["id"],other["id"])
    assert exc.value.status_code==409
    assert "resources" not in store.checkpoints()[0]


def test_disconnected_docker_does_not_fabricate_running_zero(tmp_path):
    store=Store(str(tmp_path/"db.sqlite"));state=sources();state["docker"]["status"]="unavailable"
    assert Workloads(store,state).view(scope_values())["summary"]["running_containers"] is None


def test_authenticated_checkpoint_and_optional_connection_endpoints(tmp_path,monkeypatch):
    app=create_app(Settings(token=TOKEN,db=str(tmp_path/"db.sqlite"),gitlab_connection_file=str(tmp_path/"gitlab.json")),collect=False)
    with TestClient(app) as client:
        headers={"Authorization":"Bearer "+TOKEN}
        assert client.get("/api/workloads").status_code==401
        assert client.post("/api/checkpoints",json={"title":"No auth"}).status_code==401
        app.state.snapshot.update(sources())
        result=client.post("/api/checkpoints",headers=headers,json={"title":"First","scope":{"project":"all"}})
        assert result.status_code==200
        identifier=result.json()["id"]
        assert client.get("/api/checkpoints/"+identifier,headers=headers).json()["title"]=="First"
        assert client.get("/api/checkpoints",headers=headers).json()[0]["id"]==identifier
        assert client.get("/api/workloads?kind=images&size=1",headers=headers).json()["size"]==1
        assert client.get("/api/integrations/gitlab",headers=headers).json()["token_configured"] is False
        calls=[]
        def respond(*args,**kwargs):
            calls.append(kwargs)
            return httpx.Response(200,json={"id":1},request=httpx.Request("GET",args[0]))
        monkeypatch.setattr(httpx,"get",respond)
        response=client.post("/api/integrations/gitlab",headers=headers,json={"url":"https://gitlab.example","token":"secret-read-api","projects":["3"],"auto_observed":True})
        assert response.status_code==200 and "secret-read-api" not in response.text
        assert calls[0]["headers"]["PRIVATE-TOKEN"]=="secret-read-api"
        assert (tmp_path/"gitlab.json").stat().st_mode&0o777==0o600
        assert client.post("/api/integrations/gitlab",headers=headers,json={"url":"https://other.example","token":"","projects":[]}).status_code==400
        invalid=client.post("/api/integrations/gitlab",headers=headers,json={"token":"sensitive"*100})
        assert invalid.status_code==422 and "sensitive" not in invalid.text
        assert client.post("/api/integrations/gitlab",headers=headers,json={"enabled":False}).status_code==200
        assert client.get("/api/integrations/gitlab",headers=headers).json()["enabled"] is False
