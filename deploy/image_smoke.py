"""Real local-Docker build/save/load verification using only disposable test images."""
import io
import json
from pathlib import Path
import secrets
import sys
import tarfile
import tempfile
import time

import docker
from fastapi.testclient import TestClient
from backend.config import Settings
from backend.main import create_app

def main():
    engine=docker.from_env(timeout=60)
    reference='opsdeck-operation-test:'+secrets.token_hex(6)
    aliased=reference+'-alias'
    token=secrets.token_urlsafe(40)
    headers={'Authorization':'Bearer '+token}
    with tempfile.TemporaryDirectory(prefix='opsdeck-image-roundtrip-') as directory:
        root=Path(directory)
        context=io.BytesIO()
        with tarfile.open(fileobj=context,mode='w') as archive:
            for name,content in {'Dockerfile':'FROM scratch\nCOPY marker /marker\nLABEL opsdeck.test=true\n','marker':'local smoke test\n'}.items():
                data=content.encode(); info=tarfile.TarInfo(name); info.size=len(data); archive.addfile(info,io.BytesIO(data))
        app=create_app(Settings(token=token,operations=True,db=str(root/'db.sqlite'),image_upload_dir=str(root/'uploads')),collect=False)
        try:
            with TestClient(app) as client:
                def stage(kind,data):
                    response=client.post('/api/operations/uploads?kind='+kind+'&name=smoke.tar',headers=headers,content=data)
                    assert response.status_code==200,response.text
                    return response.json()['id']
                def operate(action,values):
                    response=client.post('/api/operations/preview',headers=headers,json={'action':action,'values':values}); assert response.status_code==200,response.text
                    plan=response.json()
                    response=client.post('/api/operations/execute',headers=headers,json={'nonce':plan['nonce'],'confirmation':plan['confirmation']}); assert response.status_code==200,response.text
                    identifier=response.json()['id'];deadline=time.monotonic()+90
                    while time.monotonic()<deadline:
                        job=next(job for job in client.get('/api/operations/jobs',headers=headers).json() if job['id']==identifier)
                        if job['status'] not in ('queued','running'): assert job['status']=='success',job;return
                        time.sleep(.2)
                    raise AssertionError('Image operation timed out')
                identifier=stage('context',context.getvalue())
                operate('build_image',{'upload_id':identifier,'reference':reference,'dockerfile':'Dockerfile'})
                image=engine.images.get(reference)
                operate('tag_image',{'source_id':image.id,'reference':aliased})
                archive=b''.join(engine.images.get(aliased).save(named=aliased))
                engine.images.remove(aliased)
                identifier=stage('image',archive)
                operate('load_image',{'upload_id':identifier})
                assert engine.images.get(aliased).id==image.id
                assert app.state.store.operations()[0]['status']=='success'
                sys.stdout.write('Real Docker operation round trip passed: authenticated context upload, build, pinned-ID tag, docker-save upload/load, import verification, and persistent task results.\n')
        finally:
            for tag in (aliased,reference):
                try: engine.images.remove(tag)
                except docker.errors.ImageNotFound: pass
            engine.close()


if __name__ == "__main__":
    main()
